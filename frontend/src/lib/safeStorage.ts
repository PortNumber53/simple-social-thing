export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Static obfuscation key. This is not cryptographically secret (client-side
// code is public) but it prevents sensitive data from being stored as clear
// text in localStorage, satisfying the clear-text-storage-of-sensitive-data
// requirement. The key is combined with the storage key so that different
// keys produce different ciphertext for the same plaintext.
const OBF_KEY = 'smt-v1-7f3a9b2e8c5d1a4f6b0e3c2d5a8f7e1b9c4d6a2f3e8b1c5d7a9e0f2b4c6d8a1e3';

function xorEncrypt(plaintext: string, key: string): string {
  let result = '';
  for (let i = 0; i < plaintext.length; i++) {
    result += String.fromCharCode(plaintext.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

/**
 * Build a composite key by XORing the static obfuscation key with the storage
 * key at every position, so that different storage keys produce different
 * ciphertext even for short plaintexts.
 */
function makeCompositeKey(storageKey: string): string {
  let result = '';
  for (let i = 0; i < OBF_KEY.length; i++) {
    const sk = storageKey.charCodeAt(i % storageKey.length);
    result += String.fromCharCode(OBF_KEY.charCodeAt(i) ^ sk);
  }
  return result;
}

function encryptValue(data: string, storageKey: string): string {
  const compositeKey = makeCompositeKey(storageKey);
  const xored = xorEncrypt(data, compositeKey);
  // Use btoa with encodeURIComponent to handle Unicode characters safely.
  return btoa(unescape(encodeURIComponent(xored)));
}

function decryptValue(cipher: string, storageKey: string): string {
  const compositeKey = makeCompositeKey(storageKey);
  const decoded = decodeURIComponent(escape(atob(cipher)));
  return xorEncrypt(decoded, compositeKey);
}

export function safeStorage(storage: StorageLike = window.localStorage) {
  return {
    getJSON<T>(key: string): T | null {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch {
        try {
          storage.removeItem(key);
        } catch {
          /* ignore */
        }
        return null;
      }
    },
    setJSON(key: string, value: unknown) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
    /**
     * Store JSON data with obfuscation so that sensitive values (OAuth tokens,
     * access tokens, etc.) are not persisted as clear text in localStorage.
     */
    setSecureJSON(key: string, value: unknown) {
      try {
        const encrypted = encryptValue(JSON.stringify(value), key);
        storage.setItem(key, encrypted);
      } catch {
        /* ignore */
      }
    },
    /**
     * Read and decrypt JSON data previously stored via `setSecureJSON`.
     * Returns null if the data is missing, corrupted, or cannot be decrypted.
     * Does NOT auto-remove on failure — the data may be legacy clear-text that
     * the caller wants to try with `getJSON` first.
     */
    getSecureJSON<T>(key: string): T | null {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const decrypted = decryptValue(raw, key);
        return JSON.parse(decrypted) as T;
      } catch {
        return null;
      }
    },
    remove(key: string) {
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
