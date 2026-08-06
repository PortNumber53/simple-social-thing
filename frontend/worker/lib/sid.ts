import { buildSidCookie, getCookie, publicUrlForRequest } from './http';

export async function ensureBackendUser(backendOrigin: string, sid: string) {
  // best effort
  try {
    await fetch(`${backendOrigin}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
    });
  } catch {
    /* ignore */
  }
}

// Cache of session token → userId to avoid hitting the backend on every request.
// Tokens are 30-day, so a short in-memory TTL is fine.
const sessionCache = new Map<string, { userId: string; expiresAt: number }>();
const SESSION_CACHE_TTL_MS = 60_000; // 1 minute

// resolveSidToken calls the backend to resolve a session token to a user ID.
// Returns null if the session is invalid, expired, or the backend is unreachable.
export async function resolveSidToken(backendOrigin: string, token: string): Promise<string | null> {
  // Check cache first
  const cached = sessionCache.get(token);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.userId;
  }

  try {
    const res = await fetch(`${backendOrigin}/api/sessions/${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json() as { userId?: string };
    if (!body.userId) return null;
    sessionCache.set(token, { userId: body.userId, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
    return body.userId;
  } catch {
    return null;
  }
}

// createLocalSession creates a user + session for local dev auto-create flow.
// Returns the session token to use as the cookie value.
export async function createLocalSession(backendOrigin: string, userId: string): Promise<string | null> {
  try {
    // Ensure user exists
    await fetch(`${backendOrigin}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, email: '', name: 'Local Dev User', imageUrl: null }),
    });
    // Create session
    const res = await fetch(`${backendOrigin}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return null;
    const body = await res.json() as { token?: string };
    if (!body.token) return null;
    sessionCache.set(body.token, { userId, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
    return body.token;
  } catch {
    return null;
  }
}

export async function requireSid(opts: {
  request: Request;
  headers: Headers;
  backendOrigin: string;
  allowLocalAutoCreate: boolean;
}): Promise<string | null> {
  const { request, headers, backendOrigin, allowLocalAutoCreate } = opts;
  const cookie = request.headers.get('Cookie') || '';
  const sidToken = getCookie(cookie, 'sid');
  const publicUrl = publicUrlForRequest(request);
  const requestUrl = publicUrl.toString();
  const isLocal =
    publicUrl.hostname === 'localhost' ||
    publicUrl.hostname === '127.0.0.1' ||
    publicUrl.hostname.endsWith('.dev.portnumber53.com');

  // If we have a session token cookie, resolve it to a user ID via the backend.
  if (sidToken) {
    const userId = await resolveSidToken(backendOrigin, sidToken);
    if (userId) return userId;
    // Token is invalid/expired — fall through to local auto-create if allowed.
  }

  // Local dev auto-create: generate a new user + session.
  if (allowLocalAutoCreate && isLocal) {
    const newUserId = crypto.randomUUID();
    const newToken = await createLocalSession(backendOrigin, newUserId);
    if (newToken) {
      headers.append('Set-Cookie', buildSidCookie(newToken, 60 * 60 * 24 * 30, requestUrl));
      return newUserId;
    }
    // Fallback: if backend session creation fails, use the old flow (best effort).
    headers.append('Set-Cookie', buildSidCookie(newUserId, 60 * 60 * 24 * 30, requestUrl));
    await ensureBackendUser(backendOrigin, newUserId);
    return newUserId;
  }

  return null;
}
