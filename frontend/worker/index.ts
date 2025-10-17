interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  XATA_API_KEY?: string;
  XATA_DATABASE_URL?: string;
  USE_MOCK_AUTH?: string;
}

async function persistSocialConnection(
  env: Env,
  conn: { userId: string; provider: string; providerId: string; email?: string; name?: string }
) {
  if (!env.XATA_API_KEY || !env.XATA_DATABASE_URL) return;
  const base = env.XATA_DATABASE_URL.replace(/\/$/, '');
  const id = `${conn.provider}:${conn.providerId}`;
  // Try create
  const createRes = await fetch(`${base}/tables/SocialConnections/data`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.XATA_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      id,
      userId: conn.userId,
      provider: conn.provider,
      providerId: conn.providerId,
      email: conn.email,
      name: conn.name,
    })
  });
  if (createRes.ok) return;
  // If exists, update by id
  await fetch(`${base}/tables/SocialConnections/data/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.XATA_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      userId: conn.userId,
      provider: conn.provider,
      providerId: conn.providerId,
      email: conn.email,
      name: conn.name,
    })
  }).catch(() => {});
}

async function persistUser(
  env: Env,
  user: { id: string; email: string; name: string; imageUrl?: string }
) {
  if (!env.XATA_API_KEY || !env.XATA_DATABASE_URL) return;
  const base = env.XATA_DATABASE_URL.replace(/\/$/, '');
  // Try create
  const createRes = await fetch(`${base}/tables/users/data`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.XATA_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ id: user.id, email: user.email, name: user.name, imageUrl: user.imageUrl })
  });
  if (createRes.ok) return;
  // If create failed (likely exists), try update by id
  await fetch(`${base}/tables/users/data/${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.XATA_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ email: user.email, name: user.name, imageUrl: user.imageUrl })
  }).catch(() => {});
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Handle OAuth callback first (more specific route)
    if (url.pathname === "/api/auth/google/callback") {
      return handleOAuthCallback(request, env);
    }

    // Handle other API routes
    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        name: "Cloudflare",
      });
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const redirectUri = new URL('/api/auth/google/callback', url.origin).toString();

  // Determine client URL dynamically
  // For local dev: worker is on :8787, frontend is on :5173
  // For production: both are on the same domain
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost
    ? `http://localhost:5173`
    : url.origin.replace(/\/api.*$/, '');

  // Handle OAuth errors
  if (error) {
    return Response.json({
      error: error,
      error_description: url.searchParams.get('error_description')
    }, { status: 400 });
  }

  // Validate required parameters
  if (!code) {
    return Response.json({
      error: 'missing_code',
      error_description: 'Authorization code is required'
    }, { status: 400 });
  }

  try {
    // For local development, return mock data if external APIs are not accessible
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const useMock = isLocalhost && env.USE_MOCK_AUTH === 'true';

    if (useMock) {
      // Mock successful OAuth response for local development
      const mockUserData = {
        id: 'mock-google-id-123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://via.placeholder.com/150',
      };
      await persistUser(env, {
        id: mockUserData.id,
        email: mockUserData.email,
        name: mockUserData.name,
        imageUrl: mockUserData.picture,
      });
      await persistSocialConnection(env, {
        userId: mockUserData.id,
        provider: 'google',
        providerId: mockUserData.id,
        email: mockUserData.email,
        name: mockUserData.name,
      });
      const userDataParam = encodeURIComponent(JSON.stringify({
        success: true,
        user: {
          id: mockUserData.id,
          email: mockUserData.email,
          name: mockUserData.name,
          imageUrl: mockUserData.picture,
          accessToken: 'mock-access-token',
        },
      }));

      return Response.redirect(`${clientUrl}?oauth=${userDataParam}`, 302);
    }

    // Exchange authorization code for access token (production)
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return Response.json({
        error: 'token_exchange_failed',
        error_description: 'Failed to exchange authorization code for token'
      }, { status: 500 });
    }

    const tokenData: GoogleTokenResponse = await tokenResponse.json();

    // Get user information using the access token
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!userResponse.ok) {
      console.error('User info fetch failed:', userResponse.statusText);
      return Response.json({
        error: 'user_info_failed',
        error_description: 'Failed to fetch user information'
      }, { status: 500 });
    }

    const userData: GoogleUserInfo = await userResponse.json();

    // Create user data for frontend
    const frontendUserData = {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      imageUrl: userData.picture,
      accessToken: tokenData.access_token,
    };

    await persistUser(env, {
      id: frontendUserData.id,
      email: frontendUserData.email,
      name: frontendUserData.name,
      imageUrl: frontendUserData.imageUrl,
    });
    await persistSocialConnection(env, {
      userId: frontendUserData.id,
      provider: 'google',
      providerId: userData.id,
      email: frontendUserData.email,
      name: frontendUserData.name,
    });

    // Redirect back to frontend with user data in URL parameter
    const userDataParam = encodeURIComponent(JSON.stringify({
      success: true,
      user: frontendUserData,
    }));

    return Response.redirect(`${clientUrl}?oauth=${userDataParam}`, 302);

  } catch (error) {
    console.error('OAuth callback error:', error);
    return Response.json({
      error: 'internal_error',
      error_description: 'An internal error occurred during OAuth processing'
    }, { status: 500 });
  }
}
