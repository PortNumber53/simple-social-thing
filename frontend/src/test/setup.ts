import '@testing-library/jest-dom/vitest';
import { vi, beforeAll, afterEach } from 'vitest';

// Global fetch mock to prevent real network requests (ECONNREFUSED errors).
// Individual tests can override this with vi.stubGlobal('fetch', ...) for specific responses.
const defaultFetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  // Return sensible defaults for common API patterns
  if (url.includes('/api/')) {
    return new Response(JSON.stringify({ ok: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Default empty response for anything else
  return new Response('', { status: 200 });
});

beforeAll(() => {
  vi.stubGlobal('fetch', defaultFetchMock);
});

afterEach(() => {
  // Reset the mock between tests but keep it in place
  defaultFetchMock.mockClear();
});

// Some environments (notably Cloudflare worker runtimes) expose a `localStorage` implementation
// that requires extra runtime flags (e.g. `--localstorage-file`). Our frontend code relies on
// localStorage heavily, so tests provide a stable in-memory implementation.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  get length() {
    return this.store.size;
  }
}

try {
  // Touching localStorage may throw in restricted runtimes; if so, replace it.
  // Also install the polyfill if localStorage is missing entirely (e.g. happy-dom).
   
  void globalThis.localStorage?.getItem('__probe__');
} catch {
  // runtime threw
}
// Detect whether the built-in localStorage is usable (happy-dom may provide a
// proxy that lacks clear() and prevents property overrides). If not, replace it.
let localStorageUsable = false;
try {
  if (globalThis.localStorage) {
    globalThis.localStorage.setItem('__ls_probe__', '1');
    globalThis.localStorage.removeItem('__ls_probe__');
    if (typeof globalThis.localStorage.clear === 'function') {
      localStorageUsable = true;
    }
  }
} catch {
  // threw
}
if (!localStorageUsable) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

// JSDOM doesn't implement media blob URL helpers; many pages rely on them for previews.
if (typeof URL !== 'undefined') {
  if (typeof URL.createObjectURL !== 'function') {
     
    (URL as any).createObjectURL = () => 'blob:vitest';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
     
    (URL as any).revokeObjectURL = () => void 0;
  }
}
