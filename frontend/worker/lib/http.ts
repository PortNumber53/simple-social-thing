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

function firstForwardedHeader(headers: Headers, name: string): string | null {
  const v = (headers.get(name) || '').trim();
  if (!v) return null;
  // X-Forwarded-* may be a comma-separated list; take the first hop.
  return v.split(',')[0].trim() || null;
}

// Reconstruct the browser-facing URL when running behind a reverse proxy.
// Example: nginx (https://simple.dev...) -> Vite -> worker (http://localhost:18912)
export function publicUrlForRequest(request: Request): URL {
  const u = new URL(request.url);
  const xfHost = firstForwardedHeader(request.headers, 'X-Forwarded-Host');
  const xfProto = firstForwardedHeader(request.headers, 'X-Forwarded-Proto');
  if (xfHost) {
    u.host = xfHost;
    // If forwarded host has no explicit port, do not leak internal dev ports.
    if (!xfHost.includes(':')) u.port = '';
  }
  if (xfProto) {
    u.protocol = xfProto.endsWith(':') ? xfProto : `${xfProto}:`;
    if (xfProto === 'https') u.port = '';
  }
  // Dev hardening: if we're behind a TLS-terminating reverse proxy and the proxy forgot to forward
  // `X-Forwarded-Proto: https`, infer https for our dev hostnames so cookies/localStorage don't split
  // across `http://` vs `https://` origins.
  if (!xfProto && xfHost) {
    const hostNoPort = xfHost.split(':')[0].trim().toLowerCase();
    if (hostNoPort.endsWith('.dev.portnumber53.com')) {
      u.protocol = 'https:';
      u.port = '';
    }
  }
  return u;
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
