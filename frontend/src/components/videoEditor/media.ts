import type { MediaKind } from './types';

export async function getMediaDurationSec(objectUrl: string, kind: MediaKind): Promise<number> {
  if (kind === 'image') return 0;
  return await new Promise<number>((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.src = objectUrl;

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out reading media metadata'));
    }, 8000);

    const cleanup = () => {
      window.clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      try {
        el.src = '';
      } catch {
        /* ignore */
      }
    };

    el.onloadedmetadata = () => {
      const dur = Number.isFinite(el.duration) ? Number(el.duration) : 0;
      cleanup();
      resolve(Math.max(0, dur));
    };
    el.onerror = () => {
      cleanup();
      reject(new Error('Failed to read media metadata'));
    };
  });
}


