import '@testing-library/jest-dom/vitest';

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
  // eslint-disable-next-line no-void
  void globalThis.localStorage?.getItem('__probe__');
} catch {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

// JSDOM doesn't implement media blob URL helpers; many pages rely on them for previews.
if (typeof URL !== 'undefined') {
  if (typeof URL.createObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = () => 'blob:vitest';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = () => void 0;
  }
}
