export function getCookie(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    if (k === name) return decodeURIComponent(p.slice(idx + 1));
  }
  return null;
}

export function buildSidCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const url = requestUrl ? new URL(requestUrl) : null;
  const parts = [`sid=${encodeURIComponent(value)}`, `Path=/`, `HttpOnly`, `SameSite=Lax`];
  if (maxAgeSeconds > 0) parts.push(`Max-Age=${maxAgeSeconds}`);
  else parts.push('Max-Age=0');
  // Local dev: cookie must be visible to both :18910 and :18912 → set Domain=localhost
  if (url && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) parts.push('Domain=localhost');
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export function buildCorsHeaders(request: Request): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers();
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'true');
  } else {
    headers.set('Access-Control-Allow-Origin', '*');
  }
  return headers;
}
