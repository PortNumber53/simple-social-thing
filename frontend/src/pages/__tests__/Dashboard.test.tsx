import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { Dashboard } from '../Dashboard';

vi.mock('../../contexts/IntegrationsContext', () => {
  return {
    useIntegrations: () => ({
      status: {
        instagram: { connected: true, account: { username: 'iggy' } },
        facebook: { connected: true, account: { name: 'FB Page' } },
      },
      connectedProviders: ['instagram', 'facebook', 'youtube'],
      facebookPages: [{ id: '1', name: 'Page One', tasks: ['CREATE_CONTENT'], canPost: true }],
      isLoading: false,
      error: null,
      refreshStatus: vi.fn(),
      refreshFacebookPages: vi.fn(),
    }),
  };
});

describe('Dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'Alice Example' }));
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
      headers: new Headers(),
    })) as any;
  });

  it('shows dashboard welcome, stats, and connected accounts', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <Dashboard />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    // Welcome heading with user's first name
    expect(screen.getByRole('heading', { name: /Welcome back, Alice/i })).toBeInTheDocument();

    // Quick actions
    expect(screen.getByText('Compose Post')).toBeInTheDocument();

    // Stats cards — use getAllByText since labels appear in both stat title and link
    await waitFor(() => expect(screen.getAllByText(/Drafts/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Scheduled/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Connected networks/i)).toBeInTheDocument();
    // 3 connected publish-capable providers: instagram, facebook, youtube
    expect(screen.getByText(/3 \/ 5/i)).toBeInTheDocument();

    // Connected accounts section
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();

    // Getting started section
    expect(screen.getByText('Getting started')).toBeInTheDocument();
  });
});
