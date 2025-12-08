import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface GoogleLoginButtonProps {
  buttonText?: string;
  className?: string;
}

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({
  buttonText = 'Sign in with Google',
  className = ''
}) => {
  const { logout, isAuthenticated, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = () => {
    setIsLoading(true);

    // Generate Google OAuth URL that redirects to our current origin
    // The Vite dev server will proxy /api requests to the worker
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const redirectUri = `${window.location.origin}/api/auth/google/callback`;
    const scope = 'openid email profile';
    const state = Math.random().toString(36).substring(2, 15);

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scope)}&` +
      `response_type=code&` +
      `state=${encodeURIComponent(state)}&` +
      `access_type=offline&` +
      `prompt=consent`;

    // Prefer a popup to keep the current page state; fallback to full redirect if blocked.
    const popup = window.open(
      authUrl,
      'google-oauth',
      'width=480,height=640,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes',
    );
    if (!popup) {
      window.location.href = authUrl;
      return;
    }
    popup.focus();

    // Watch the popup: when it returns to our origin (callback redirects), drive the opener to the app.
    // Leave the popup visible for a few seconds so errors (JSON) can be read in prod.
    const targetPath = '/dashboard';
    const started = Date.now();
    const maxWaitMs = 2 * 60 * 1000;
    const poll = window.setInterval(() => {
      const elapsed = Date.now() - started;
      try {
        if (popup.closed) {
          window.clearInterval(poll);
          window.location.href = targetPath;
          return;
        }
      } catch {
        // Swallow cross-origin access errors until the popup navigates back to our origin.
      }

      try {
        const loc = popup.location;
        if (loc && loc.host === window.location.host) {
          window.clearInterval(poll);
          window.location.href = targetPath;
          // Give the popup a short grace period so any JSON/error can be inspected.
          window.setTimeout(() => {
            try {
              popup.close();
            } catch {
              /* ignore */
            }
          }, 15000);
          return;
        }
      } catch {
        // cross-origin while on accounts.google.com; ignore
      }

      if (elapsed > maxWaitMs) {
        window.clearInterval(poll);
      }
    }, 700);
  };

  if (isAuthenticated && user) {
    return (
      <div className={`flex items-center gap-4 ${className}`}>
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <img
            src={user.imageUrl}
            alt={user.name}
            className="w-8 h-8 rounded-full ring-2 ring-primary-400"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              console.error('Failed to load avatar image in button:', user.imageUrl);
              target.src = 'https://via.placeholder.com/150';
            }}
          />
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.name}</span>
        </div>
        <button
          onClick={logout}
          className="btn btn-ghost text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleGoogleLogin}
      disabled={isLoading}
      className={`btn btn-secondary gap-3 px-6 py-3 shadow-md hover:shadow-lg ${className}`}
    >
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-600 border-t-primary-600 rounded-full animate-spin" />
      ) : (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      )}
      <span className="font-semibold">{isLoading ? 'Signing in...' : buttonText}</span>
    </button>
  );
};
