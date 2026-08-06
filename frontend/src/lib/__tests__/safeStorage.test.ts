import { describe, expect, it, vi, beforeEach } from 'vitest';
import { safeStorage } from '../safeStorage';

describe('safeStorage', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
  });

  const makeStorage = (overrides: Partial<Storage> = {}): Storage => {
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      ...overrides,
    } as unknown as Storage;
  };

  it('getJSON returns parsed value', () => {
    store.set('key', '{"name":"test"}');
    const s = safeStorage(makeStorage());
    expect(s.getJSON('key')).toEqual({ name: 'test' });
  });

  it('getJSON returns null for missing key', () => {
    const s = safeStorage(makeStorage());
    expect(s.getJSON('missing')).toBeNull();
  });

  it('getJSON returns null and removes key on parse error', () => {
    store.set('bad', 'not json');
    const removeItem = vi.fn((k: string) => store.delete(k));
    const s = safeStorage(makeStorage({ removeItem }));
    expect(s.getJSON('bad')).toBeNull();
    expect(removeItem).toHaveBeenCalledWith('bad');
  });

  it('setJSON stores JSON string', () => {
    const setItem = vi.fn((k: string, v: string) => store.set(k, v));
    const s = safeStorage(makeStorage({ setItem }));
    s.setJSON('key', { a: 1 });
    expect(setItem).toHaveBeenCalledWith('key', '{"a":1}');
  });

  it('setJSON swallows errors', () => {
    const setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });
    const s = safeStorage(makeStorage({ setItem }));
    expect(() => s.setJSON('key', { a: 1 })).not.toThrow();
  });

  it('remove deletes key', () => {
    store.set('key', 'val');
    const removeItem = vi.fn((k: string) => store.delete(k));
    const s = safeStorage(makeStorage({ removeItem }));
    s.remove('key');
    expect(removeItem).toHaveBeenCalledWith('key');
    expect(store.has('key')).toBe(false);
  });

  it('remove swallows errors', () => {
    const removeItem = vi.fn(() => {
      throw new Error('denied');
    });
    const s = safeStorage(makeStorage({ removeItem }));
    expect(() => s.remove('key')).not.toThrow();
  });
});
