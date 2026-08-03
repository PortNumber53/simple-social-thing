/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import worker, { buildCorsHeaders, buildSidCookie, getBackendUrl, getCookie } from '../index';

describe('worker helper functions', () => {
  it('getCookie returns decoded cookie values', () => {
    const h = 'a=1; sid=hello%20world; x=y';
    expect(getCookie(h, 'sid')).toBe('hello world');
    expect(getCookie(h, 'missing')).toBeNull();
  });

  it('buildSidCookie includes localhost domain in local dev', () => {
    const c = buildSidCookie('abc', 60, 'http://localhost:18910');
    expect(c).toContain('sid=abc');
    expect(c).toContain('Path=/');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Max-Age=60');
    expect(c).toContain('Domain=localhost');
    expect(c).not.toContain('Secure');
  });

  it('buildCorsHeaders allows credentials for explicit Origin', () => {
    // Use Headers object to bypass forbidden header restrictions in some DOM environments
    const reqHeaders = new Headers();
    reqHeaders.set('Origin', 'https://client.example.com');
    const req = new Request('https://example.com/api/x', { headers: reqHeaders });
    const headers = buildCorsHeaders(req);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://client.example.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(headers.get('Vary')).toBe('Origin');
  });

  it('getBackendUrl: uses BACKEND_URL if present (normalizes scheme)', () => {
    const req = new Request('https://simple.acme.co/api/x');
    const origin = getBackendUrl({ BACKEND_URL: 'api-simple.acme.co' } as any, req);
    expect(origin).toBe('https://api-simple.acme.co');
  });

  it('getBackendUrl: local requests default to dev backend port', () => {
    const req = new Request('http://localhost:18912/api/x');
    const origin = getBackendUrl({} as any, req);
    expect(origin).toBe('http://localhost:18911');
  });

  it('proxies authenticated Instagram Agent requests to the current user backend route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://backend.example/api/instagram-agent/generate/user/u1') {
        return new Response(JSON.stringify({ ok: true, content: 'generated' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected_target', url }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const request = new Request('https://app.example/api/instagram-agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': 'sid=u1' },
        body: JSON.stringify({ type: 'post', input: 'coffee' }),
      });
      const response = await worker.fetch(request, { BACKEND_URL: 'https://backend.example' } as any);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, content: 'generated' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
