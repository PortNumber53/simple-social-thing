import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { IntegrationsProvider } from '../../contexts/IntegrationsContext';
import { ThemeProvider } from '../../contexts/ThemeContext';

import { ContentPosts } from '../ContentPosts';
import { ContentVideos } from '../ContentVideos';
import { InstagramAgent } from '../InstagramAgent';
import { Library } from '../Library';
import { Profile } from '../Profile';
import { Settings } from '../Settings';

function renderWithProviders(ui: React.ReactElement, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <IntegrationsProvider>{ui}</IntegrationsProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Authenticated pages', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key')) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/tracks')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/api/posts/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/api/uploads/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/api/social-libraries/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/api/library/items')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/api/instagram-agent/')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith('/api/user-settings')) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        if (url.includes('/api/user-settings/')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.includes('/api/social-connections/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/api/billing/subscription/')) {
          return new Response(JSON.stringify({ status: 'none' }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
      }),
    );
  });

  it('renders ContentPosts page', async () => {
    renderWithProviders(<ContentPosts />, { route: '/content/posts' });
    await waitFor(() => {
      expect(screen.getByText(/Publish Post/i)).toBeInTheDocument();
    });
  });

  it('renders ContentVideos page', async () => {
    renderWithProviders(<ContentVideos />, { route: '/content/videos' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Videos/i })).toBeInTheDocument();
    });
  });

  it('renders InstagramAgent page', async () => {
    renderWithProviders(<InstagramAgent />, { route: '/instagram-agent' });
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { name: /Instagram/i });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Library page', async () => {
    renderWithProviders(<Library />, { route: '/library' });
    await waitFor(() => {
      expect(screen.getByText(/Media browser/i)).toBeInTheDocument();
    });
  });

  it('renders Profile page', async () => {
    renderWithProviders(<Profile />, { route: '/profile' });
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { name: /Profile/i });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders Settings page', async () => {
    renderWithProviders(<Settings />, { route: '/settings' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Settings/i })).toBeInTheDocument();
    });
  });
});
