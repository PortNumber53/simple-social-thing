/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { buildCorsHeaders, buildSidCookie, getBackendOrigin, getCookie } from '../index';

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

  it('getBackendOrigin: uses BACKEND_ORIGIN if present (normalizes scheme)', () => {
    const req = new Request('https://simple.acme.co/api/x');
    const origin = getBackendOrigin({ BACKEND_ORIGIN: 'api-simple.acme.co' } as any, req);
    expect(origin).toBe('https://api-simple.acme.co');
  });

  it('getBackendOrigin: local requests default to dev backend port', () => {
    const req = new Request('http://localhost:18912/api/x');
    const origin = getBackendOrigin({} as any, req);
    expect(origin).toBe('http://localhost:18911');
  });
});
