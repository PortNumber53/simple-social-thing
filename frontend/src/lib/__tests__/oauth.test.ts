import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleOAuthCallback } from '../oauth';
import { exchangeCodeForToken } from '../oauth';

describe('oauth handleOAuthCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when it receives google-oauth-success from same origin', async () => {
    const p = handleOAuthCallback();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'google-oauth-success', user: { id: 'u1' } },
      }),
    );

    await expect(p).resolves.toEqual({ id: 'u1' });
  });

  it('rejects when it receives google-oauth-error from same origin', async () => {
    const p = handleOAuthCallback();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'google-oauth-error', error: 'boom' },
      }),
    );

    await expect(p).rejects.toThrow('boom');
  });

  it('times out after 60s if no message arrives', async () => {
    const p = handleOAuthCallback();
    const assertion = expect(p).rejects.toThrow('OAuth timeout');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});

describe('oauth exchangeCodeForToken', () => {
  it('exchanges code and returns user + accessToken', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, scope: 's', token_type: 'Bearer' }), { status: 200 });
      }
      if (url.includes('googleapis.com/oauth2/v2/userinfo')) {
        return new Response(JSON.stringify({ id: 'u1', email: 'e', name: 'User', picture: 'p' }), { status: 200 });
      }
      return new Response('not_found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const out = await exchangeCodeForToken('code123');
    expect(out).toEqual({ id: 'u1', email: 'e', name: 'User', picture: 'p', accessToken: 'tok' });
  });
});
