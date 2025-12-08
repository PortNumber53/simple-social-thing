import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
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

  it('shows dashboard tasks and live state pulled from the app contexts', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Dashboard />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/delivery dashboard/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/0 drafts · 0 scheduled/i)).toBeInTheDocument());

    expect(screen.getByText(/auth \+ integrations/i)).toBeInTheDocument();
    expect(screen.getByText(/instagram/i)).toBeInTheDocument();
    expect(screen.getByText(/facebook pages/i)).toBeInTheDocument();
    expect(screen.getByText(/automation \+ realtime/i)).toBeInTheDocument();
    expect(screen.getByText(/5 suno credits/i)).toBeInTheDocument();

    expect(screen.getByText(/implementation board/i)).toBeInTheDocument();
    expect(screen.getByText(/OAuth \+ session bootstrap/i)).toBeInTheDocument();
    expect(screen.getByText(/Social integrations/i)).toBeInTheDocument();
    expect(screen.getByText(/Publishing pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Local library \+ scheduler/i)).toBeInTheDocument();
    expect(screen.getByText(/AI music \(Suno\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Instagram video tool/i)).toBeInTheDocument();
    expect(screen.getByText(/Backend \+ deploy/i)).toBeInTheDocument();
  });
});
