/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  imageUrl?: string;
  accessToken?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (userData: User) => void;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Hydrate synchronously to avoid header flash
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      localStorage.removeItem('user');
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAndCacheUserSettings = async () => {
    try {
      const res = await fetch('/api/user-settings', { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== 'object') return;
      // Store only the sanitized `data` document.
      if ('data' in (data as any)) {
        localStorage.setItem('user_settings', JSON.stringify((data as any).data ?? {}));
      }
    } catch { void 0; }
  };

  useEffect(() => {
    // Check for OAuth callback data in URL (for redirect flow)
    const run = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const oauthData = urlParams.get('oauth');

      if (!oauthData) return;

      setIsLoading(true);
      try {
        const userData = JSON.parse(decodeURIComponent(oauthData));

        if (userData.success && userData.user) {
          setUser(userData.user);
          localStorage.setItem('user', JSON.stringify(userData.user));
          setError(null);

          // Prime browser cache for user_settings to reduce post-login page load times.
          await fetchAndCacheUserSettings();

          // Redirect to dashboard after successful authentication
          window.history.replaceState({}, document.title, '/dashboard');
          window.location.href = '/dashboard';
          return;
        }

        if (userData.error) {
          setError(userData.error_description || userData.error);
          // Clean up URL on error
          window.history.replaceState({}, document.title, '/');
          setIsLoading(false);
          return;
        }

        setError('Authentication failed');
        window.history.replaceState({}, document.title, '/');
        setIsLoading(false);
      } catch (e: unknown) {
        console.error('Error processing OAuth callback:', e);
        setError('Authentication failed');
        // Clean up URL on error
        window.history.replaceState({}, document.title, '/');
        setIsLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    // Refresh settings cache in background when the app boots with an already-authenticated user.
    if (!user) return;
    void fetchAndCacheUserSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const login = (userData: User) => {
    setUser(userData);
    setError(null);
    localStorage.setItem('user', JSON.stringify(userData));
    void fetchAndCacheUserSettings();
  };

  const logout = () => {
    setUser(null);
    setError(null);
    localStorage.removeItem('user');
    localStorage.removeItem('user_settings');
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
