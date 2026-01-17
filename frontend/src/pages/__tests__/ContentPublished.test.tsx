import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ContentPublished } from '../ContentPublished';

describe('ContentPublished', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();
  });

  it('loads items, filters by network, and toggles view mode', async () => {
    const u = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/library/items')) {
          return new Response(
            JSON.stringify([
              { id: '1', network: 'instagram', contentType: 'post', title: 'Hello', postedAt: new Date().toISOString() },
              { id: '2', network: 'youtube', contentType: 'video', title: 'World', postedAt: new Date().toISOString() },
            ]),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/user-settings')) return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <ContentPublished />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /Published/i })).toBeInTheDocument();

    // Filter to instagram only
    const selects = document.querySelectorAll('select');
    const networkSelect = selects[0] as HTMLSelectElement | undefined;
    if (!networkSelect) throw new Error('missing network select');
    await u.selectOptions(networkSelect, 'instagram');

    await waitFor(() => {
      expect(document.body.textContent || '').toContain('Hello');
      expect(document.body.textContent || '').not.toContain('World');
    });

    // Toggle to gallery mode
    await u.click(screen.getByRole('button', { name: /Gallery/i }));
    await waitFor(() => {
      expect(localStorage.getItem('publishedViewMode')).toBe('gallery');
    });
  });

  it('selects in gallery mode and deletes selected items', async () => {
    const u = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/library/items')) {
          return new Response(
            JSON.stringify([
              { id: '1', network: 'instagram', contentType: 'post', title: 'Hello', postedAt: new Date().toISOString() },
            ]),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/library/delete') && init?.method === 'POST') {
          return new Response(JSON.stringify({ ok: true, deleted: 1 }), { status: 200 });
        }
        if (url.endsWith('/api/user-settings')) return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <ContentPublished />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /Published/i })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Gallery/i }));

    // Select the single item checkbox (avoid the "delete external" option checkbox)
    const cb = screen.getByRole('checkbox', { name: /^select/i });
    await u.click(cb);

    // Remove selected from library - opens confirmation modal
    await u.click(screen.getByRole('button', { name: /Remove from library/i }));
    // Click confirm button in modal
    await u.click(screen.getByRole('button', { name: /^Remove$/i }));
    await waitFor(() => {
      expect((globalThis.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/api/library/delete'))).toBe(true);
    });
  });
});
