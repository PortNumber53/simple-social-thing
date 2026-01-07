import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { TopNavigation } from '../TopNavigation';

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider>
        <AuthProvider>
          <TopNavigation />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('TopNavigation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows public nav links when logged out', () => {
    renderNav();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
  });

  it('shows authenticated nav links when logged in', () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    renderNav();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Drafts')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('toggles mobile menu and closes on Escape', async () => {
    const u = userEvent.setup();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    renderNav();

    const button = screen.getByRole('button', { name: /open menu/i });
    await u.click(button);
    expect(screen.getByRole('button', { name: /close menu/i })).toBeInTheDocument();

    await u.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
  });
});
