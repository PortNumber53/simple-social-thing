/**
 * OAuth utility functions for Google authentication
 */

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  accessToken?: string;
}

/**
 * Exchanges authorization code for access token and user info
 * Note: In a production app, this should be done server-side for security
 */
export const exchangeCodeForToken = async (code: string): Promise<GoogleUser> => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET; // You'll need to add this
  const redirectUri = window.location.origin;

  try {
    // Exchange code for token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userData = await userResponse.json();

    return {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      picture: userData.picture,
      accessToken,
    };
  } catch (error) {
    console.error('OAuth exchange error:', error);
    throw error;
  }
};

/**
 * Simple popup OAuth handler
 */
export const handleOAuthCallback = (): Promise<GoogleUser> => {
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data.type === 'google-oauth-success') {
        window.removeEventListener('message', handleMessage);
        resolve(event.data.user);
      } else if (event.data.type === 'google-oauth-error') {
        window.removeEventListener('message', handleMessage);
        reject(new Error(event.data.error));
      }
    };

    window.addEventListener('message', handleMessage);

    // Set a timeout in case the popup closes without sending a message
    setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error('OAuth timeout'));
    }, 60000); // 1 minute timeout
  });
};
