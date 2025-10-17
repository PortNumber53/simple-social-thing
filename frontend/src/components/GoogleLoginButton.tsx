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

    // Generate Google OAuth URL that redirects to our worker
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    
    // Determine worker origin dynamically
    // In production, use the current origin (same domain as frontend)
    // In local dev, use VITE_WORKER_ORIGIN if set (e.g., http://localhost:8787)
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const workerOrigin = (isLocalhost && import.meta.env.VITE_WORKER_ORIGIN) 
      ? import.meta.env.VITE_WORKER_ORIGIN 
      : window.location.origin;
    
    const redirectUri = `${workerOrigin}/api/auth/google/callback`;
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

    // Redirect to Google OAuth (no popup needed since worker handles the callback)
    window.location.href = authUrl;
  };

  if (isAuthenticated && user) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <img
          src={user.imageUrl}
          alt={user.name}
          className="w-8 h-8 rounded-full"
        />
        <span className="text-sm font-medium">{user.name}</span>
        <button
          onClick={logout}
          className="text-sm text-red-600 hover:text-red-800"
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
      className={`flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 ${className}`}
    >
      {isLoading ? (
        <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24">
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
      <span>{isLoading ? 'Signing in...' : buttonText}</span>
    </button>
  );
};
