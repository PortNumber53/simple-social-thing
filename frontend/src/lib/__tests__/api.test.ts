import { describe, expect, it, vi } from 'vitest';
import { apiFetch, apiJson } from '../api';

describe('apiFetch', () => {
  it('includes credentials by default', async () => {
    const mockFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await apiFetch('https://example.com/api/test');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/test',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('preserves provided credentials', async () => {
    const mockFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await apiFetch('https://example.com/api/test', { credentials: 'omit' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/test',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });
});

describe('apiJson', () => {
  it('returns ok result for successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"data":"hello"}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    const result = await apiJson<{ data: string }>('https://example.com/api/test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ data: 'hello' });
      expect(result.status).toBe(200);
    }
  });

  it('returns error result for failed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"not_found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })),
    );

    const result = await apiJson('https://example.com/api/test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error.message).toBe('not_found');
    }
  });

  it('returns network_error on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network failure');
      }),
    );

    const result = await apiJson('https://example.com/api/test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.error.message).toBe('network failure');
    }
  });

  it('falls back to request_failed status code when no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('null', { status: 503 })),
    );

    const result = await apiJson('https://example.com/api/test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('request_failed_503');
    }
  });
});
