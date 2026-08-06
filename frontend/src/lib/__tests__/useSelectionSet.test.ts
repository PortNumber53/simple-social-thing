import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionSet } from '../useSelectionSet';

describe('useSelectionSet', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSelectionSet(['a', 'b', 'c']));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('setSelected adds and removes', () => {
    const { result } = renderHook(() => useSelectionSet(['a', 'b']));
    act(() => result.current.setSelected('a', true));
    expect(result.current.selectedIds.has('a')).toBe(true);
    expect(result.current.selectedCount).toBe(1);
    act(() => result.current.setSelected('a', false));
    expect(result.current.selectedIds.has('a')).toBe(false);
  });

  it('toggle flips selection', () => {
    const { result } = renderHook(() => useSelectionSet(['a']));
    act(() => result.current.toggle('a'));
    expect(result.current.selectedIds.has('a')).toBe(true);
    act(() => result.current.toggle('a'));
    expect(result.current.selectedIds.has('a')).toBe(false);
  });

  it('addMany adds multiple', () => {
    const { result } = renderHook(() => useSelectionSet(['a', 'b', 'c']));
    act(() => result.current.addMany(['a', 'b', 'c']));
    expect(result.current.selectedCount).toBe(3);
  });

  it('clear empties selection', () => {
    const { result } = renderHook(() => useSelectionSet(['a', 'b']));
    act(() => result.current.addMany(['a', 'b']));
    expect(result.current.selectedCount).toBe(2);
    act(() => result.current.clear());
    expect(result.current.selectedCount).toBe(0);
  });

  it('prunes selection when presentIds change', () => {
    const { result, rerender } = renderHook(({ ids }) => useSelectionSet(ids), { initialProps: { ids: ['a', 'b', 'c'] } });
    act(() => result.current.addMany(['a', 'b', 'c']));
    expect(result.current.selectedCount).toBe(3);
    rerender({ ids: ['a', 'b'] });
    expect(result.current.selectedIds.has('c')).toBe(false);
    expect(result.current.selectedCount).toBe(2);
  });
});
