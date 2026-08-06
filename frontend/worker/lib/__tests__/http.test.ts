import { describe, expect, it } from 'vitest';
import { buildSidCookie, publicUrlForRequest, getCookie, buildCorsHeaders } from '../http';

describe('getCookie', () => {
  it('extracts cookie value by name', () => {
    expect(getCookie('sid=abc; foo=bar', 'sid')).toBe('abc');
    expect(getCookie('sid=abc; foo=bar', 'foo')).toBe('bar');
  });

  it('returns null for missing cookie', () => {
    expect(getCookie('sid=abc', 'missing')).toBeNull();
  });

  it('handles encoded values', () => {
    expect(getCookie('sid=hello%20world', 'sid')).toBe('hello world');
  });
});

describe('buildSidCookie', () => {
  it('builds cookie with correct attributes for localhost', () => {
    const cookie = buildSidCookie('test-token', 3600, 'http://localhost:3000');
    expect(cookie).toContain('sid=test-token');
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Domain=localhost');
  });

  it('builds cookie with Secure flag for https', () => {
    const cookie = buildSidCookie('test-token', 3600, 'https://example.com');
    expect(cookie).toContain('Secure');
  });

  it('does not set Secure for http', () => {
    const cookie = buildSidCookie('test-token', 3600, 'http://localhost:3000');
    expect(cookie).not.toContain('Secure');
  });

  it('sets Max-Age=0 when maxAgeSeconds is 0', () => {
    const cookie = buildSidCookie('test-token', 0, 'http://localhost:3000');
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('publicUrlForRequest', () => {
  it('returns original URL when no forwarded headers', () => {
    const req = new Request('https://api.example.com/test');
    const url = publicUrlForRequest(req);
    expect(url.host).toBe('api.example.com');
    expect(url.protocol).toBe('https:');
  });

  it('uses X-Forwarded-Host and X-Forwarded-Proto', () => {
    const req = new Request('http://localhost:18912/test', {
      headers: {
        'X-Forwarded-Host': 'app.proxy.com',
        'X-Forwarded-Proto': 'https',
      },
    });
    const url = publicUrlForRequest(req);
    expect(url.host).toBe('app.proxy.com');
    expect(url.protocol).toBe('https:');
  });

  it('infers https for .dev.portnumber53.com hosts', () => {
    const req = new Request('http://localhost:18912/test', {
      headers: { 'X-Forwarded-Host': 'simple16.dev.portnumber53.com' },
    });
    const url = publicUrlForRequest(req);
    expect(url.protocol).toBe('https:');
  });
});

describe('buildCorsHeaders', () => {
  it('sets ACAO to origin when present', () => {
    const req = {
      headers: new Headers({ Origin: 'https://app.com' }),
    } as unknown as Request;
    const headers = buildCorsHeaders(req);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://app.com');
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('sets ACAO to * when no origin', () => {
    const req = {
      headers: new Headers(),
    } as unknown as Request;
    const headers = buildCorsHeaders(req);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
