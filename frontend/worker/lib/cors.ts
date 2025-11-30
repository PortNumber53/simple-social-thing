import { buildCorsHeaders } from './http';

export function withCors(
  request: Request,
  opts: { methods: string; allowHeaders?: string },
): { headers: Headers; preflight: Response | null } {
  const headers = buildCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', opts.methods);
    headers.set('Access-Control-Allow-Headers', opts.allowHeaders || request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
    return { headers, preflight: new Response(null, { status: 204, headers }) };
  }
  return { headers, preflight: null };
}
