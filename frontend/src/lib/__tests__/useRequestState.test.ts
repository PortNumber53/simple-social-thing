import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRequestState } from '../useRequestState';

describe('useRequestState', () => {
  it('tracks loading and returns result on success', async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const { result } = renderHook(() => useRequestState(fn));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    let res: number | undefined;
    await act(async () => {
      res = await result.current.run(5);
    });

    expect(res).toBe(10);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledWith(5);
  });

  it('sets error on failure', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useRequestState(fn));

    await act(async () => {
      await expect(result.current.run()).rejects.toThrow('boom');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
    expect(result.current.loading).toBe(false);
  });

  it('sets default error message for non-Error throws', async () => {
    const fn = vi.fn(async () => {
      throw 'string error';
    });
    const { result } = renderHook(() => useRequestState(fn));

    await act(async () => {
      await expect(result.current.run()).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('string error');
    });
  });
});
