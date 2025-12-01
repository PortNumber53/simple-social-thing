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

export async function requireSid(opts: {
  request: Request;
  headers: Headers;
  backendOrigin: string;
  allowLocalAutoCreate: boolean;
}): Promise<string | null> {
  const { request, headers, backendOrigin, allowLocalAutoCreate } = opts;
  const cookie = request.headers.get('Cookie') || '';
  let sid = getCookie(cookie, 'sid');
  const publicUrl = publicUrlForRequest(request);
  const requestUrl = publicUrl.toString();
  const isLocal =
    publicUrl.hostname === 'localhost' ||
    publicUrl.hostname === '127.0.0.1' ||
    publicUrl.hostname.endsWith('.dev.portnumber53.com');

  if (!sid && allowLocalAutoCreate && isLocal) {
    sid = crypto.randomUUID();
    headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
    await ensureBackendUser(backendOrigin, sid);
  }
  return sid || null;
}
