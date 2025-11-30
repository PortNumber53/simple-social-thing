import { useEffect } from 'react';

export function usePolling(opts: {
  enabled: boolean;
  intervalMs: number;
  tick: () => void | Promise<void>;
}) {
  const { enabled, intervalMs, tick } = opts;

  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

    const id = window.setInterval(() => void tick(), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, tick]);
}
