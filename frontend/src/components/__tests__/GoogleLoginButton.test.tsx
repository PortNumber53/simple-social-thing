import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../contexts/AuthContext';
import { GoogleLoginButton } from '../GoogleLoginButton';

describe('GoogleLoginButton', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: 'http://localhost/' },
    });
  });

  it('renders sign-in button when logged out and sets location.href on click', async () => {
    const u = userEvent.setup();
    render(
      <AuthProvider>
        <GoogleLoginButton />
      </AuthProvider>,
    );

    const btn = screen.getByRole('button', { name: /sign in with google/i });
    await u.click(btn);
    expect(String(window.location.href)).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
  });

  it('renders user chip + sign out when logged in', () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User', imageUrl: 'x' }));
    render(
      <AuthProvider>
        <GoogleLoginButton />
      </AuthProvider>,
    );
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
