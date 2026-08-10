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

  describe('setSecureJSON / getSecureJSON', () => {
    it('stores data in obfuscated form (not clear text)', () => {
      const s = safeStorage(makeStorage());
      const sensitive = { token: 'secret-access-token-12345' };
      s.setSecureJSON('user', sensitive);
      // The stored value must NOT contain the plaintext token.
      const raw = store.get('user');
      expect(raw).toBeTruthy();
      expect(raw).not.toContain('secret-access-token-12345');
      expect(raw).not.toContain('token');
    });

    it('round-trips data correctly', () => {
      const s = safeStorage(makeStorage());
      const data = { id: 'u1', email: 'a@b.com', name: 'Alice', accessToken: 'tok123' };
      s.setSecureJSON('user', data);
      expect(s.getSecureJSON('user')).toEqual(data);
    });

    it('returns null for missing key', () => {
      const s = safeStorage(makeStorage());
      expect(s.getSecureJSON('missing')).toBeNull();
    });

    it('returns null for corrupted data without auto-removing', () => {
      store.set('corrupt', 'not-valid-base64!!!');
      const removeItem = vi.fn((k: string) => store.delete(k));
      const s = safeStorage(makeStorage({ removeItem }));
      expect(s.getSecureJSON('corrupt')).toBeNull();
      // getSecureJSON does not auto-remove; caller handles cleanup.
      expect(removeItem).not.toHaveBeenCalled();
    });

    it('produces different ciphertext for different storage keys', () => {
      const s = safeStorage(makeStorage());
      s.setSecureJSON('keyA', { val: 'same' });
      s.setSecureJSON('keyB', { val: 'same' });
      expect(store.get('keyA')).not.toBe(store.get('keyB'));
    });

    it('handles Unicode characters in data', () => {
      const s = safeStorage(makeStorage());
      const data = { name: '日本語テスト🎉', emoji: '👋' };
      s.setSecureJSON('user', data);
      expect(s.getSecureJSON('user')).toEqual(data);
    });

    it('setSecureJSON swallows errors', () => {
      const setItem = vi.fn(() => {
        throw new Error('quota exceeded');
      });
      const s = safeStorage(makeStorage({ setItem }));
      expect(() => s.setSecureJSON('key', { a: 1 })).not.toThrow();
    });
  });
});
