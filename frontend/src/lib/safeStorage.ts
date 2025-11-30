export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
    remove(key: string) {
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
