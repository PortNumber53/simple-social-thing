import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

export const TopNavigation: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false); // desktop account dropdown
  const [mobileOpen, setMobileOpen] = useState(false); // mobile hamburger menu
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<any>>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileButtonRef = useRef<HTMLButtonElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);

  const navItemBase =
    "inline-flex items-center h-10 px-3 rounded-md text-sm font-medium transition-colors";
  const navItemColors =
    "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800";
  const navItemPublicColors =
    "text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400";
  const contentLinks = [
    { href: '/content/published', label: 'Published' },
    { href: '/content/posts', label: 'Posts' },
    { href: '/content/videos', label: 'Videos' },
    { href: '/content/video-editor', label: 'Video Editor' },
    { href: '/content/music', label: 'Music' },
  ];
  const ContentLinksList: React.FC<{
    onItemClick?: () => void;
    itemClassName: string;
    rounded?: boolean;
  }> = ({ onItemClick, itemClassName, rounded = false }) => (
    <>
      {contentLinks.map((item, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === contentLinks.length - 1;
        const rounding = rounded ? `${isFirst ? 'rounded-t-md' : ''} ${isLast ? 'rounded-b-md' : ''}` : '';
        return (
          <a
            key={item.href}
            href={item.href}
            onClick={onItemClick}
            className={`${itemClassName} ${rounding}`.trim()}
          >
            {item.label}
          </a>
        );
      })}
    </>
  );

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (notifOpen && notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (mobileOpen) {
        const inPanel = mobileMenuRef.current && mobileMenuRef.current.contains(target);
        const inButton = mobileButtonRef.current && mobileButtonRef.current.contains(target);
        if (!inPanel && !inButton) setMobileOpen(false);
      }
    };
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setNotifOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [menuOpen, notifOpen, mobileOpen]);

  const loadNotifications = async () => {
    if (!user) return;
    const res = await apiJson<any[]>(`/api/notifications?limit=30`);
    if (res.ok && Array.isArray(res.data)) {
      setNotifications(res.data);
      const unread = res.data.filter((n: any) => !n.readAt).length;
      setUnreadCount(unread);
    }
  };

  const markRead = async (id: string) => {
    if (!user) return;
    await apiJson(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n: any) => (n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    void loadNotifications();

    // Realtime: refresh on notification.created
    const onRealtime = (ev: Event) => {
      const ce = ev as CustomEvent;
      const msg = ce?.detail as any;
      if (!msg || typeof msg !== 'object') return;
      if (String(msg.type || '') !== 'notification.created') return;
      void loadNotifications();
    };
    window.addEventListener('realtime:event', onRealtime as EventListener);
    return () => window.removeEventListener('realtime:event', onRealtime as EventListener);
  }, [user?.id]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/50">
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand */}
          <a href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/30 group-hover:shadow-primary-500/50 transition-shadow">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-xl font-bold gradient-text">Simple Social Thing</span>
          </a>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-2 flex-1 ml-8">
            {user ? (
              <>
                <a href="/dashboard" className={`${navItemBase} ${navItemColors}`}>
                  Dashboard
                </a>
                <a href="/library" className={`${navItemBase} ${navItemColors}`}>
                  Drafts
                </a>
                <div className="relative group">
                  <button className={`${navItemBase} ${navItemColors} gap-1`}>
                    Content
                    <svg className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <div className="absolute left-0 top-full mt-0 w-48 rounded-md bg-white dark:bg-slate-900 shadow-lg ring-1 ring-black/5 dark:ring-white/10 opacity-0 pointer-events-none translate-y-1 group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto transition duration-150">
                    <ContentLinksList
                      rounded
                      itemClassName="block px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    />
                  </div>
                </div>
                <a href="/reports" className={`${navItemBase} ${navItemColors}`}>
                  Reports
                </a>
                <a href="/account/settings" className={`${navItemBase} ${navItemColors}`}>
                  Settings
                </a>
              </>
            ) : (
              <>
                <a href="/" className={`${navItemBase} ${navItemPublicColors}`}>
                  Home
                </a>
                <a href="/features" className={`${navItemBase} ${navItemPublicColors}`}>
                  Features
                </a>
                <a href="/contact" className={`${navItemBase} ${navItemPublicColors}`}>
                  Contact
                </a>
                <a href="/pricing" className={`${navItemBase} ${navItemPublicColors}`}>
                  Pricing
                </a>
              </>
            )}
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-4">
            {/* Notifications */}
            {user && (
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  aria-label="Notifications"
                  className="relative inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  onClick={() => {
                    setNotifOpen((v) => !v);
                    setMenuOpen(false);
                    void loadNotifications();
                  }}
                >
                  <svg className="w-5 h-5 text-slate-700 dark:text-slate-200" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6z" />
                    <path d="M7 14a3 3 0 006 0H7z" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] font-semibold">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-96 rounded-md shadow-lg bg-white dark:bg-slate-900 ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200/60 dark:border-slate-700/50">
                      <div className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300">Notifications</div>
                      <button
                        type="button"
                        className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                        onClick={() => void loadNotifications()}
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="max-h-[420px] overflow-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-slate-600 dark:text-slate-300">No notifications.</div>
                      ) : (
                        <ul className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
                          {notifications.map((n: any) => {
                            const isUnread = !n.readAt;
                            const url = typeof n.url === 'string' ? n.url : '';
                            return (
                              <li key={n.id} className={`${isUnread ? 'bg-primary-50/40 dark:bg-primary-900/10' : ''}`}>
                                <a
                                  href={url || '#'}
                                  target={url ? '_blank' : undefined}
                                  rel={url ? 'noreferrer' : undefined}
                                  onClick={(e) => {
                                    if (!url) e.preventDefault();
                                    void markRead(String(n.id));
                                  }}
                                  className="block px-4 py-3 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className={`text-sm font-medium ${isUnread ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'} truncate`}>
                                        {String(n.title || 'Notification')}
                                      </div>
                                      {n.body && (
                                        <div className="text-xs text-slate-600 dark:text-slate-300 mt-1 overflow-hidden">
                                          {String(n.body)}
                                        </div>
                                      )}
                                      {url && (
                                        <div className="text-xs text-primary-700 dark:text-primary-300 mt-1 truncate">
                                          {url}
                                        </div>
                                      )}
                                    </div>
                                    <div className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                                      {n.createdAt ? new Date(String(n.createdAt)).toLocaleString() : ''}
                                    </div>
                                  </div>
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              ref={mobileButtonRef}
              type="button"
              className="md:hidden inline-flex items-center justify-center rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? (
                <svg className="w-5 h-5 text-slate-700 dark:text-slate-200" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-slate-700 dark:text-slate-200" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M3 5.75A.75.75 0 013.75 5h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.75zm0 4.25A.75.75 0 013.75 9.25h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 10zm0 4.25a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            {/* Desktop account dropdown */}
            {user && (
              <div
                className="relative hidden md:block"
                ref={menuRef}
                onMouseEnter={() => setMenuOpen(true)}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="flex items-center gap-1 px-1 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <a
                    href="/dashboard"
                    className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <img
                      src={user.imageUrl || 'https://via.placeholder.com/150'}
                      alt={user.name}
                      className="w-8 h-8 rounded-full ring-2 ring-primary-400"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'https://via.placeholder.com/150';
                      }}
                    />
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.name}</span>
                  </a>
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="Open account menu"
                    className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <svg className={`w-4 h-4 text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-0 w-48 rounded-md shadow-lg bg-white dark:bg-slate-900 ring-1 ring-black/5 dark:ring-white/10 focus:outline-none py-1">
                    <a href="/account/profile" className="block px-4 py-2 text-sm rounded-md text-slate-700 dark:text-slate-200 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                      Profile
                    </a>
                    <a href="/account/settings" className="block px-4 py-2 text-sm rounded-md text-slate-700 dark:text-slate-200 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                      Settings
                    </a>
                    <a href="/integrations" className="block px-4 py-2 text-sm rounded-md text-slate-700 dark:text-slate-200 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                      Integrations
                    </a>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left block px-4 py-2 text-sm rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <div className="md:hidden">
          {/* Backdrop */}
          <div className="fixed inset-0 top-16 bg-black/20" aria-hidden="true" />

          <div
            ref={mobileMenuRef}
            className="fixed top-16 left-0 right-0 border-b border-slate-200/60 dark:border-slate-700/50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-2">
              {user ? (
                <>
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/50">
                    <img
                      src={user.imageUrl || 'https://via.placeholder.com/150'}
                      alt={user.name}
                      className="w-9 h-9 rounded-full ring-2 ring-primary-400"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'https://via.placeholder.com/150';
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.name}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">Account</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <a href="/dashboard" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemColors} justify-start w-full`}>
                      Dashboard
                    </a>
                    <a href="/library" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemColors} justify-start w-full`}>
                      Drafts
                    </a>
                    <a href="/reports" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemColors} justify-start w-full`}>
                      Reports
                    </a>
                    <a href="/integrations" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemColors} justify-start w-full`}>
                      Integrations
                    </a>
                  </div>

                  <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/50 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40">
                      Content
                    </div>
                    <div className="p-2 grid grid-cols-1 gap-1">
                      <ContentLinksList
                        onItemClick={() => setMobileOpen(false)}
                        itemClassName={`${navItemBase} ${navItemColors} justify-start w-full`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <a href="/account/profile" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemColors} justify-start w-full`}>
                      Profile
                    </a>
                    <a href="/account/settings" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemColors} justify-start w-full`}>
                      Settings
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMobileOpen(false);
                      handleLogout();
                    }}
                    className="w-full inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium bg-red-600 text-white hover:bg-red-700 active:scale-95 transition-all duration-200"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <a href="/" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemPublicColors} justify-start w-full`}>
                    Home
                  </a>
                  <a href="/features" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemPublicColors} justify-start w-full`}>
                    Features
                  </a>
                  <a href="/contact" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemPublicColors} justify-start w-full`}>
                    Contact
                  </a>
                  <a href="/pricing" onClick={() => setMobileOpen(false)} className={`${navItemBase} ${navItemPublicColors} justify-start w-full`}>
                    Pricing
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};
