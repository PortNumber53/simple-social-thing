import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { IntegrationsProvider } from '../../contexts/IntegrationsContext';
import { Integrations } from '../Integrations';

describe('Integrations', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();
  });

  it('parses connection status from URL param and persists to localStorage', async () => {
    const payload = encodeURIComponent(JSON.stringify({ success: true, account: { id: 'ig1', username: 'alice' } }));
    window.history.replaceState({}, '', `/integrations?instagram=${payload}`);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) {
          return new Response(JSON.stringify({ instagram: { connected: true, account: { id: 'ig1', username: 'alice' } } }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key') && (!init || init.method === undefined)) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/integrations']}>
        <AuthProvider>
          <IntegrationsProvider>
            <Integrations />
          </IntegrationsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Instagram connected successfully/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem('ig_conn')).toContain('"id":"ig1"');
    });
  });

  it('saves Suno API key and shows status', async () => {
    const u = userEvent.setup();
    window.history.replaceState({}, '', '/integrations');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) return new Response(JSON.stringify({}), { status: 200 });
        if (url.endsWith('/api/integrations/suno/api-key') && (!init || init.method === undefined)) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key') && init?.method === 'PUT') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <IntegrationsProvider>
            <Integrations />
          </IntegrationsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const input = screen.getByPlaceholderText(/Enter your Suno API key/i);
    await u.type(input, 'abc');
    await u.click(screen.getByRole('button', { name: /Save key/i }));
    expect(await screen.findByText(/Suno API key saved/i)).toBeInTheDocument();
  });

  it('disconnects an integration (best-effort) and clears localStorage cache', async () => {
    const u = userEvent.setup();
    // Seed local cached connection
    localStorage.setItem('ig_conn', JSON.stringify({ id: 'ig1', username: 'alice' }));
    window.history.replaceState({}, '', '/integrations');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) {
          return new Response(JSON.stringify({ instagram: { connected: true, account: { id: 'ig1', username: 'alice' } } }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/instagram/disconnect') && init?.method === 'POST') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key') && (!init || init.method === undefined)) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <IntegrationsProvider>
            <Integrations />
          </IntegrationsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Wait for connected badge, then disconnect
    expect(await screen.findByText(/Connected/i)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Disconnect/i }));
    await waitFor(() => expect(localStorage.getItem('ig_conn')).toBeNull());
  });

  it('renders multiple connected providers from cached localStorage and shows TikTok scopes', async () => {
    // Seed cached connections; this exercises the "load existing connection from localStorage" branch.
    localStorage.setItem('ig_conn', JSON.stringify({ id: 'ig1', username: 'alice' }));
    localStorage.setItem('tt_conn', JSON.stringify({ id: 'tt1', displayName: 't' }));
    localStorage.setItem('fb_conn', JSON.stringify({ id: 'fb1', name: 'fb' }));
    localStorage.setItem('yt_conn', JSON.stringify({ id: 'yt1', name: 'yt' }));
    localStorage.setItem('pin_conn', JSON.stringify({ id: 'pin1', name: 'pin' }));
    localStorage.setItem('th_conn', JSON.stringify({ id: 'th1', name: 'th' }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) {
          return new Response(
            JSON.stringify({
              instagram: { connected: true, account: { id: 'ig1', username: 'alice' } },
              tiktok: { connected: true, account: { id: 'tt1', displayName: 't' } },
              facebook: { connected: true, account: { id: 'fb1', name: 'fb' } },
              youtube: { connected: true, account: { id: 'yt1', name: 'yt' } },
              pinterest: { connected: true, account: { id: 'pin1', name: 'pin' } },
              threads: { connected: true, account: { id: 'th1', name: 'th' } },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/integrations/tiktok/scopes')) {
          return new Response(JSON.stringify({ ok: true, scope: 'x', requestedScopes: 'x', hasVideoList: true }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key')) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <IntegrationsProvider>
            <Integrations />
          </IntegrationsProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // The TikTok card should show the derived scopes status line.
    expect(await screen.findByText(/Video import enabled/i)).toBeInTheDocument();
  });
});
