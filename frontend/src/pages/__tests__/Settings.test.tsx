import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { Settings } from '../Settings';

describe('Settings page', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and shows success message, then can dismiss', async () => {
    const u = userEvent.setup();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <Settings />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    await u.click(screen.getByRole('button', { name: /save settings/i }));
    expect(screen.getByText(/Saving/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Settings saved successfully!/i)).toBeInTheDocument();
    }, { timeout: 2000 });

    await u.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/Settings saved successfully!/i)).not.toBeInTheDocument();
  });
});
