import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveSidToken, createLocalSession, requireSid } from '../sid';

describe('resolveSidToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns userId when backend resolves session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ userId: 'user123' }), { status: 200 })),
    );
    const result = await resolveSidToken('http://localhost:18911', 'test-token');
    expect(result).toBe('user123');
  });

  it('returns null when backend returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    const result = await resolveSidToken('http://localhost:18911', 'bad-token');
    expect(result).toBeNull();
  });

  it('returns null on fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network error');
      }),
    );
    const result = await resolveSidToken('http://localhost:18911', 'error-token-unique-1');
    expect(result).toBeNull();
  });
});

describe('createLocalSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns token when backend creates session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ token: 'new-token' }), { status: 201 })),
    );
    const result = await createLocalSession('http://localhost:18911', 'new-user-id');
    expect(result).toBe('new-token');
  });

  it('returns null on fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network error');
      }),
    );
    const result = await createLocalSession('http://localhost:18911', 'new-user-id');
    expect(result).toBeNull();
  });
});

describe('requireSid', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns userId when valid sid cookie exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/sessions/')) {
          return new Response(JSON.stringify({ userId: 'user123' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const headers = new Headers();
    const req = {
      url: 'http://localhost:3000/',
      headers: new Headers({ Cookie: 'sid=valid-token-unique-2' }),
    } as unknown as Request;
    const result = await requireSid({
      request: req,
      headers,
      backendOrigin: 'http://localhost:18911',
      allowLocalAutoCreate: false,
    });
    expect(result).toBe('user123');
  });

  it('returns null when no sid and auto-create disabled', async () => {
    const headers = new Headers();
    const result = await requireSid({
      request: new Request('http://localhost:3000/'),
      headers,
      backendOrigin: 'http://localhost:18911',
      allowLocalAutoCreate: false,
    });
    expect(result).toBeNull();
  });

  it('auto-creates session for local dev when allowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.includes('/api/sessions')) {
          return new Response(JSON.stringify({ token: 'auto-token' }), { status: 201 });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const headers = new Headers();
    const result = await requireSid({
      request: new Request('http://localhost:3000/'),
      headers,
      backendOrigin: 'http://localhost:18911',
      allowLocalAutoCreate: true,
    });
    expect(result).toBeTruthy();
    expect(headers.get('Set-Cookie')).toContain('sid=');
  });
});
