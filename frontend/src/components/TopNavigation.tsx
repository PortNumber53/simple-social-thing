import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const TopNavigation: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const navItemBase =
    "inline-flex items-center h-10 px-3 rounded-md text-sm font-medium transition-colors";
  const navItemColors =
    "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800";
  const navItemPublicColors =
    "text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400";

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                <div className="relative group">
                  <button className={`${navItemBase} ${navItemColors} gap-1`}>
                    Content
                    <svg className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <div className="absolute left-0 top-full mt-2 w-48 rounded-md bg-white dark:bg-slate-900 shadow-lg ring-1 ring-black/5 dark:ring-white/10 opacity-0 pointer-events-none translate-y-1 group-hover:translate-y-2 group-hover:opacity-100 group-hover:pointer-events-auto transition duration-150">
                    <a href="/content/posts" className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-t-md">Posts</a>
                    <a href="/content/videos" className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">Videos</a>
                    <a href="/content/music" className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-b-md">Music</a>
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
            {user && (
              <div
                className="relative"
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
    </nav>
  );
};
