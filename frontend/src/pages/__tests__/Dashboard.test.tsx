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
    localStorage.setItem(
      'user_settings',
      JSON.stringify({
        suno_credits: { availableCredits: 5, fetchedAt: '2024-01-01T00:00:00Z' },
        suno_api_key: 'abc',
      }),
    );
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
      headers: new Headers(),
    })) as any;
  });

  it('shows dashboard stats and next steps pulled from the app contexts', async () => {
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

    // Top metric cards
    await waitFor(() => expect(screen.getByText(/Ready to edit or publish now/i)).toBeInTheDocument());
    expect(screen.getByText(/scheduled posts/i)).toBeInTheDocument();
    expect(screen.getByText(/publish-ready networks/i)).toBeInTheDocument();
    // With 3 connected publish-capable providers in the mock: instagram, facebook, youtube
    expect(screen.getByText(/3 \/ 5/i)).toBeInTheDocument();

    // What to do next section
    expect(screen.getByText(/What to do next/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect remaining providers/i)).toBeInTheDocument();
    expect(screen.getByText(/Wire the Instagram video tool/i)).toBeInTheDocument();
    expect(screen.getByText(/Refresh Suno credits/i)).toBeInTheDocument();
  });
});
