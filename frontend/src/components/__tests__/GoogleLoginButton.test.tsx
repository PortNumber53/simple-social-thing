import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../contexts/AuthContext';
import { GoogleLoginButton } from '../GoogleLoginButton';

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    const fakePopup = {
      focus: vi.fn(),
      close: vi.fn(),
      closed: false,
      location: { host: 'accounts.google.com', href: 'https://accounts.google.com' },
    };
    vi.stubGlobal('open', vi.fn().mockReturnValue(fakePopup));
  });

  it('opens a popup for Google OAuth when clicked', async () => {
    const u = userEvent.setup();
    render(
      <AuthProvider>
        <GoogleLoginButton />
      </AuthProvider>,
    );

    const btn = screen.getByRole('button', { name: /sign in with google/i });
    await u.click(btn);
    expect(window.open).toHaveBeenCalledTimes(1);
    const urlArg = (window.open as any).mock.calls[0][0] as string;
    expect(urlArg).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
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
