import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { Profile } from '../Profile';

describe('Profile page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'Alice Example', imageUrl: '' }));
  });

  it('validates password mismatch and too-short password', async () => {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <Profile />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const newPw = document.getElementById('newPassword') as HTMLInputElement | null;
    const confirmPw = document.getElementById('confirmPassword') as HTMLInputElement | null;
    if (!newPw || !confirmPw) throw new Error('missing password inputs');
    await u.type(newPw, '12345678');
    await u.type(confirmPw, 'DIFFERENT');
    await u.click(screen.getByRole('button', { name: /change password/i }));
    expect(screen.getByText(/New passwords do not match/i)).toBeInTheDocument();

    // Fix match but too short
    await u.clear(newPw);
    await u.clear(confirmPw);
    await u.type(newPw, 'short');
    await u.type(confirmPw, 'short');
    await u.click(screen.getByRole('button', { name: /change password/i }));
    expect(screen.getByText(/Password must be at least 8 characters long\./i)).toBeInTheDocument();
  });

  it('simulates saving display name and shows success message', async () => {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <Profile />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Display Name/i);
    await u.clear(input);
    await u.type(input, 'Alice');
    await u.click(screen.getByRole('button', { name: /^save$/i }));
    await new Promise((r) => setTimeout(r, 1100));
    expect(screen.getByText(/Display name updated successfully!/i)).toBeInTheDocument();
  });
});
