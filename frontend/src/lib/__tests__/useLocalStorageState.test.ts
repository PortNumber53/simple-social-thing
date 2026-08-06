import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorageState } from '../useLocalStorageState';

describe('useLocalStorageState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default value when key is missing', () => {
    const { result } = renderHook(() => useLocalStorageState('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('returns stored JSON value', () => {
    localStorage.setItem('test-key', JSON.stringify({ a: 1 }));
    const { result } = renderHook(() => useLocalStorageState<{ a: number }>('test-key', { a: 0 }));
    expect(result.current[0]).toEqual({ a: 1 });
  });

  it('returns raw string for non-JSON values', () => {
    localStorage.setItem('test-key', 'raw-string');
    const { result } = renderHook(() => useLocalStorageState<string>('test-key', 'default'));
    expect(result.current[0]).toBe('raw-string');
  });

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useLocalStorageState('test-key', 'default'));
    act(() => result.current[1]('new-value'));
    expect(localStorage.getItem('test-key')).toBe('new-value');
  });

  it('persists object changes as JSON', () => {
    const { result } = renderHook(() => useLocalStorageState<{ a: number }>('test-key', { a: 0 }));
    act(() => result.current[1]({ a: 42 }));
    expect(localStorage.getItem('test-key')).toBe('{"a":42}');
  });
});
