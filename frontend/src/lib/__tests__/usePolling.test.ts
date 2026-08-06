import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolling } from '../usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls tick at specified interval', () => {
    const tick = vi.fn();
    renderHook(() => usePolling({ enabled: true, intervalMs: 1000, tick }));

    expect(tick).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('does not poll when disabled', () => {
    const tick = vi.fn();
    renderHook(() => usePolling({ enabled: false, intervalMs: 1000, tick }));

    act(() => { vi.advanceTimersByTime(5000); });
    expect(tick).not.toHaveBeenCalled();
  });

  it('does not poll with invalid interval', () => {
    const tick = vi.fn();
    renderHook(() => usePolling({ enabled: true, intervalMs: 0, tick }));

    act(() => { vi.advanceTimersByTime(5000); });
    expect(tick).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => usePolling({ enabled: true, intervalMs: 1000, tick }));

    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(tick).not.toHaveBeenCalled();
  });
});
