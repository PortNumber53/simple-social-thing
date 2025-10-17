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
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if user is stored in localStorage on app start
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('user');
      }
    }
    setIsLoading(false);

    // Check for OAuth callback data in URL (for redirect flow)
    checkForOAuthCallback();
  }, []);

  const checkForOAuthCallback = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const oauthData = urlParams.get('oauth');

    if (oauthData) {
      try {
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);

        const userData = JSON.parse(decodeURIComponent(oauthData));

        if (userData.success && userData.user) {
          setUser(userData.user);
          localStorage.setItem('user', JSON.stringify(userData.user));
          setError(null);
        } else if (userData.error) {
          setError(userData.error_description || userData.error);
        }
      } catch (error) {
        console.error('Error processing OAuth callback:', error);
        setError('Authentication failed');
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
