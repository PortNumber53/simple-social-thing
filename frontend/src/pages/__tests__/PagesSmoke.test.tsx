import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { IntegrationsProvider } from '../../contexts/IntegrationsContext';
import { ThemeProvider } from '../../contexts/ThemeContext';

import { Home } from '../Home';
import { Features } from '../Features';
import { Contact } from '../Contact';
import { Pricing } from '../Pricing';
import { PrivacyPolicy } from '../PrivacyPolicy';
import { TermsOfService } from '../TermsOfService';
import { UserDataDeletion } from '../UserDataDeletion';
import { InstagramHelp } from '../InstagramHelp';
import { Dashboard } from '../Dashboard';
import { Integrations } from '../Integrations';
import { ContentMusic } from '../ContentMusic';
import { ContentPublished } from '../ContentPublished';

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

describe('Pages smoke', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        // IntegrationsContext refreshStatus
        if (url.endsWith('/api/integrations/status')) {
          return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Integrations page: TikTok scopes + Suno key read
        if (url.endsWith('/api/integrations/tiktok/scopes')) {
          return new Response(JSON.stringify({ ok: true, scope: '', requestedScopes: '', hasVideoList: false }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key')) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        // ContentMusic
        if (url.endsWith('/api/integrations/suno/tracks')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        // ContentPublished
        if (url.includes('/api/library/items')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        // AuthProvider cache warm
        if (url.endsWith('/api/user-settings')) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it('renders public pages', () => {
    renderWithProviders(<Home />);
    expect(screen.getByRole('heading', { name: /Simple Social Thing/i })).toBeInTheDocument();

    renderWithProviders(<Features />, { route: '/features' });
    expect(screen.getByRole('heading', { name: /Features/i })).toBeInTheDocument();

    renderWithProviders(<Contact />, { route: '/contact' });
    expect(screen.getByRole('heading', { name: /Contact/i })).toBeInTheDocument();

    renderWithProviders(<Pricing />, { route: '/pricing' });
    expect(screen.getByRole('heading', { name: /Pricing/i })).toBeInTheDocument();

    renderWithProviders(<PrivacyPolicy />, { route: '/privacy-policy' });
    expect(screen.getByRole('heading', { name: /Privacy Policy/i })).toBeInTheDocument();

    renderWithProviders(<TermsOfService />, { route: '/terms-of-service' });
    expect(screen.getByRole('heading', { name: /Terms of Service/i })).toBeInTheDocument();

    renderWithProviders(<UserDataDeletion />, { route: '/user-data-deletion' });
    expect(screen.getByRole('heading', { name: /User Data Deletion/i })).toBeInTheDocument();

    renderWithProviders(<InstagramHelp />, { route: '/help/instagram' });
    expect(screen.getByRole('heading', { name: /Instagram/i })).toBeInTheDocument();
  });

  it('renders authenticated-only pages when a user is present', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    expect(screen.getByRole('heading', { name: /Welcome back/i })).toBeInTheDocument();

    renderWithProviders(<Integrations />, { route: '/integrations' });
    expect(screen.getByRole('heading', { name: /Integrations/i })).toBeInTheDocument();

    renderWithProviders(<ContentMusic />, { route: '/content/music' });
    expect(screen.getByRole('heading', { name: /Music/i })).toBeInTheDocument();

    renderWithProviders(<ContentPublished />, { route: '/content/published' });
    expect(await screen.findByRole('heading', { name: /Published/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No published items yet/i)).toBeInTheDocument();
    });
  });
});
