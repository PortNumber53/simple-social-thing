import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export const StatusBar: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [backendNow, setBackendNow] = useState<string>('—');
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastBackendTickAt, setLastBackendTickAt] = useState<number>(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') return;
    if (!isAuthenticated) {
      setWsState('disconnected');
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/api/events/ws`;
    const ws = new WebSocket(wsUrl);
    setWsState('connecting');

    ws.onopen = () => {
      setWsState('connected');
    };
    ws.onclose = () => {
      setWsState('disconnected');
    };
    ws.onerror = () => {
      setWsState('disconnected');
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as any;
        if (!msg || typeof msg !== 'object') return;
        // Broadcast all realtime messages to the app; pages can subscribe without opening extra WS connections.
        try {
          window.dispatchEvent(new CustomEvent('realtime:event', { detail: msg }));
        } catch {
          /* ignore */
        }
        if (String(msg.type || '') === 'clock' && typeof msg.now === 'string') {
          setBackendNow(msg.now);
          setLastBackendTickAt(Date.now());
        }
      } catch {
        // ignore
      }
    };

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const wsOk = useMemo(() => {
    if (wsState !== 'connected') return false;
    // mark stale if clock hasn't ticked recently (proxy might connect but not actually stream)
    if (!lastBackendTickAt) return false;
    return Date.now() - lastBackendTickAt < 3500;
  }, [lastBackendTickAt, wsState]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-800 dark:bg-slate-950 text-slate-100 border-t border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-10 text-xs">
          {/* Left side - Status */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <span className="text-slate-400">|</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${wsOk ? 'bg-green-400' : 'bg-amber-400'} animate-pulse`} />
              <span className="text-slate-200">WS</span>
              <span className="text-slate-400">{wsOk ? 'connected' : 'disconnected'}</span>
            </div>
          </div>

          {/* Center - Additional info */}
          <div className="hidden md:flex items-center gap-4">
            <span className="text-slate-400">Simple Social Thing</span>
          </div>

          {/* Right side - Backend clock */}
          <div className="flex items-center gap-4">
            <span className="text-slate-400">Backend UTC:</span>
            <span className="text-slate-100 tabular-nums">{backendNow}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
