import { useEffect, useMemo, useState } from 'react';

import { safeStorage } from './safeStorage';

export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const storage = useMemo(() => safeStorage(), []);

  const [value, setValue] = useState<T>(() => {
    // Back-compat: historically some keys stored raw strings (not JSON-encoded).
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      try {
        const parsed = JSON.parse(raw) as T;
        return parsed ?? defaultValue;
      } catch {
        return raw as unknown as T;
      }
    } catch {
      const v = storage.getJSON<T>(key);
      return v === null ? defaultValue : v;
    }
  });

  useEffect(() => {
    try {
      if (typeof value === 'string') {
        window.localStorage.setItem(key, value);
      } else {
        storage.setJSON(key, value);
      }
    } catch {
      /* ignore */
    }
  }, [key, storage, value]);

  return [value, setValue] as const;
}
