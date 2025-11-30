import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ContentMusic } from '../ContentMusic';

describe('ContentMusic', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();
  });

  it('checks credits, syncs, and generates (happy path stubs)', async () => {
    const u = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/suno/tracks')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/credits')) {
          return new Response(JSON.stringify({ ok: true, credits: { code: 0, msg: 'ok', data: 14 }, availableCredits: 14 }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/sync') && init?.method === 'POST') {
          return new Response(JSON.stringify({ ok: true, checked: 1, updated: 1 }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/generate') && init?.method === 'POST') {
          return new Response(JSON.stringify({ ok: true, suno: { taskId: 't1' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <ContentMusic />
        </AuthProvider>
      </MemoryRouter>,
    );

    await u.click(screen.getByRole('button', { name: /Check credits/i }));
    expect(await screen.findByText(/Suno credits:/i)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('user_settings') || '{}').suno_credits?.availableCredits).toBe(14);

    await u.click(screen.getByRole('button', { name: /Sync from Suno/i }));
    expect(await screen.findByText(/Synced: checked 1, updated 1/i)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: /Generate track/i }));
    await waitFor(() => expect(screen.getByText(/Generation started/i)).toBeInTheDocument());
  });
});
