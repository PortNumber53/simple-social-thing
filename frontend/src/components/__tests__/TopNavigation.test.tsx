import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopNavigation } from '../TopNavigation';

const mockLogout = vi.fn();
let mockAuth: { isAuthenticated: boolean; user: { id: string; email: string; name: string } | null; logout: typeof mockLogout } = {
  isAuthenticated: false,
  user: null,
  logout: mockLogout,
};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopNavigation />
    </MemoryRouter>,
  );
}

describe('TopNavigation', () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: false, user: null, logout: mockLogout };
    mockLogout.mockClear();
  });

  it('shows public nav links when not authenticated', () => {
    renderNav();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
  });

  it('shows authenticated nav links when logged in', () => {
    mockAuth = {
      isAuthenticated: true,
      user: { id: 'u1', email: 'a@example.com', name: 'Alice' },
      logout: mockLogout,
    };
    renderNav();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.queryByText('Features')).not.toBeInTheDocument();
    expect(screen.queryByText('Pricing')).not.toBeInTheDocument();
  });

  it('toggles mobile menu', async () => {
    const u = userEvent.setup();
    renderNav();

    const button = screen.getByRole('button', { name: /toggle menu/i });
    await u.click(button);
    // Mobile menu should show links
    const homeLinks = screen.getAllByText('Home');
    expect(homeLinks.length).toBeGreaterThan(1); // desktop + mobile
  });

  it('calls logout when Sign out is clicked', async () => {
    mockAuth = {
      isAuthenticated: true,
      user: { id: 'u1', email: 'a@example.com', name: 'Alice' },
      logout: mockLogout,
    };
    const u = userEvent.setup();
    renderNav();
    await u.click(screen.getByText('Sign out'));
    expect(mockLogout).toHaveBeenCalled();
  });
});
