import { useEffect } from 'react';

export type JobWebSocketMessage = any;

export function useJobWebSocket(opts: {
  jobId: string | null;
  path: (jobId: string) => string;
  onMessage: (msg: JobWebSocketMessage) => void;
  onError?: (e: unknown) => void;
  enabled?: boolean;
}) {
  const { jobId, path, onMessage, onError, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    if (!jobId) return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}${path(jobId)}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };
    ws.onerror = (e) => {
      onError?.(e);
    };

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, jobId, onError, onMessage, path]);
}
