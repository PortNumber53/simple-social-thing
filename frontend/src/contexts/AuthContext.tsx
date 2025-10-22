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
    } catch (e) {
      localStorage.removeItem('user');
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for OAuth callback data in URL (for redirect flow)
    checkForOAuthCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkForOAuthCallback = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const oauthData = urlParams.get('oauth');

    if (oauthData) {
      setIsLoading(true);
      try {
        const userData = JSON.parse(decodeURIComponent(oauthData));

        if (userData.success && userData.user) {
          setUser(userData.user);
          localStorage.setItem('user', JSON.stringify(userData.user));
          setError(null);
          
          // Redirect to dashboard after successful authentication
          window.history.replaceState({}, document.title, '/dashboard');
          window.location.href = '/dashboard';
        } else if (userData.error) {
          setError(userData.error_description || userData.error);
          // Clean up URL on error
          window.history.replaceState({}, document.title, '/');
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error processing OAuth callback:', error);
        setError('Authentication failed');
        // Clean up URL on error
        window.history.replaceState({}, document.title, '/');
        setIsLoading(false);
      }
    }
  };

  const login = (userData: User) => {
    setUser(userData);
    setError(null);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    setError(null);
    localStorage.removeItem('user');
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
