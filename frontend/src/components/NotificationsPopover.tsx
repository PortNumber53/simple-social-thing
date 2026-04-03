import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../lib/api';

export const NotificationsPopover: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user) return;
    const res = await apiJson<any[]>(`/api/notifications/user/${encodeURIComponent(user.id)}?limit=30`);
    if (res.ok && Array.isArray(res.data)) {
      setNotifications(res.data);
      setUnreadCount(res.data.filter((n: any) => !n.readAt).length);
    }
  };

  const markRead = async (id: string) => {
    if (!user) return;
    await apiJson(`/api/notifications/${encodeURIComponent(id)}/read/user/${encodeURIComponent(user.id)}`, { method: 'POST' });
    setNotifications((prev) => prev.map((n: any) => (n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const dismiss = async (id: string) => {
    if (!user) return;
    const notif = notifications.find((n: any) => n.id === id);
    const wasUnread = notif && !notif.readAt;
    await apiJson(`/api/notifications/${encodeURIComponent(id)}/read/user/${encodeURIComponent(user.id)}`, { method: 'POST' });
    setNotifications((prev) => prev.filter((n: any) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
  };

  const dismissAll = async () => {
    if (!user || notifications.length === 0) return;
    for (const n of notifications) {
      if (!n.readAt) {
        await apiJson(`/api/notifications/${encodeURIComponent(n.id)}/read/user/${encodeURIComponent(user.id)}`, { method: 'POST' });
      }
    }
    setNotifications([]);
    setUnreadCount(0);
  };

  useEffect(() => {
    if (!user) { setNotifications([]); setUnreadCount(0); return; }
    void load();
    const onRealtime = (ev: Event) => {
      const msg = (ev as CustomEvent)?.detail;
      if (msg && typeof msg === 'object' && String(msg.type || '') === 'notification.created') void load();
    };
    window.addEventListener('realtime:event', onRealtime as EventListener);
    return () => window.removeEventListener('realtime:event', onRealtime as EventListener);
  }, [user?.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</span>
            <div className="flex gap-1">
              <button onClick={() => void load()} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Refresh</button>
              {notifications.length > 0 && (
                <button onClick={() => void dismissAll()} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Dismiss all</button>
              )}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No notifications</div>
            ) : (
              notifications.map((n: any) => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${!n.readAt ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}
                  onClick={() => { void markRead(n.id); if (n.url) window.location.href = n.url; }}
                >
                  <div className="flex-1 min-w-0">
                    {n.title && <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{n.title}</p>}
                    {n.message && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{n.message}</p>}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void dismiss(n.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-opacity"
                    aria-label="Dismiss"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
