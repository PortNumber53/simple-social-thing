/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { apiJson } from '../lib/api';
import { safeStorage } from '../lib/safeStorage';

interface User {
  id: string;
  email: string;
  name: string;
  imageUrl?: string;
  accessToken?: string;
  profile?: {
    role?: string;
    adminLevel?: string;
    permissions?: Record<string, boolean>;
  };
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
  const storage = safeStorage();
  // Hydrate synchronously to avoid header flash
  const [user, setUser] = useState<User | null>(() => {
    return storage.getJSON<User>('user');
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAndCacheUserSettings = async () => {
    try {
      const res = await apiJson<Record<string, unknown>>('/api/user-settings');
      if (!res.ok || !res.data || typeof res.data !== 'object') return;
      // Store only the sanitized `data` document.
      if ('data' in (res.data as any)) {
        storage.setJSON('user_settings', (res.data as any).data ?? {});
      }
    } catch { void 0; }
  };

  const fetchUserProfile = async (userId: string): Promise<User['profile'] | null> => {
    try {
      // Use backend origin from environment variable
      const backendOrigin = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:18911';
      const url = `${backendOrigin}/api/users/${encodeURIComponent(userId)}`;
      const res = await apiJson<{ profile?: string }>(url);
      if (res.ok && res.data?.profile) {
        // Parse the JSON string from the database
        const profileData = JSON.parse(res.data.profile);
        return profileData as User['profile'];
      }
    } catch (error) {
      console.error('AuthContext - Error fetching profile:', error);
    }
    return null;
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
          storage.setJSON('user', userData.user);
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

  // Ensure profile is loaded for existing users
  useEffect(() => {
    if (user && !user.profile) {
      void fetchUserProfile(user.id).then((profile) => {
        if (profile) {
          const updatedUser = { ...user, profile };
          setUser(updatedUser);
          storage.setJSON('user', updatedUser);
        }
      });
    }
  }, [user]);

  const login = async (userData: User) => {
    setUser(userData);
    setError(null);

    // Fetch profile data if not already included
    if (!userData.profile) {
      const profile = await fetchUserProfile(userData.id);
      if (profile) {
        const updatedUser = { ...userData, profile };
        setUser(updatedUser);
        storage.setJSON('user', updatedUser);
      } else {
        storage.setJSON('user', userData);
      }
    } else {
      storage.setJSON('user', userData);
    }

    void fetchAndCacheUserSettings();
  };

  const logout = () => {
    setUser(null);
    setError(null);
    storage.remove('user');
    storage.remove('user_settings');
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
