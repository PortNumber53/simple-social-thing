import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthContext';
import { IntegrationsProvider, useIntegrations } from '../IntegrationsContext';

function IntegrationsConsumer() {
  const { connectedProviders, facebookPages, error } = useIntegrations();
  return (
    <div>
      <div data-testid="connected">{connectedProviders.join(',')}</div>
      <div data-testid="fb-pages">{facebookPages.map((p) => p.id).join(',')}</div>
      <div data-testid="error">{error ?? ''}</div>
    </div>
  );
}

describe('IntegrationsContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hydrates cached integrations status immediately and refreshes status on mount', async () => {
    // AuthProvider needs a user to be authenticated (used by IntegrationsProvider deps).
    localStorage.setItem('user', JSON.stringify({ id: 'u0', email: 'a', name: 'Alice' }));
    localStorage.setItem(
      'integrations_status',
      JSON.stringify({ facebook: { connected: true }, instagram: { connected: false } }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) {
          return new Response(JSON.stringify({ facebook: { connected: true } }), { status: 200 });
        }
        if (url.endsWith('/api/integrations/facebook/pages')) {
          return new Response(
            JSON.stringify({
              pages: [{ id: 'p1', name: 'Page 1', tasks: ['CREATE_CONTENT'], canPost: true }],
            }),
            { status: 200 },
          );
        }
        return new Response('not_found', { status: 404 });
      }),
    );

    render(
      <AuthProvider>
        <IntegrationsProvider>
          <IntegrationsConsumer />
        </IntegrationsProvider>
      </AuthProvider>,
    );

    // Immediate hydration from localStorage
    expect(screen.getByTestId('connected')).toHaveTextContent('facebook');

    // Refresh happens; if Facebook stays connected, pages fetch should happen.
    await waitFor(() => {
      expect(screen.getByTestId('fb-pages')).toHaveTextContent('p1');
    });

    // refreshStatus should persist to localStorage (best-effort); we can assert it was written.
    await waitFor(() => {
      expect(localStorage.getItem('integrations_status')).toContain('"facebook"');
    });
  });

  it('sets status null when status endpoint returns non-ok', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u0', email: 'a', name: 'Alice' }));
    localStorage.setItem('integrations_status', JSON.stringify({ facebook: { connected: true } }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) {
          return new Response(JSON.stringify({ error: 'nope' }), { status: 500 });
        }
        return new Response('not_found', { status: 404 });
      }),
    );

    render(
      <AuthProvider>
        <IntegrationsProvider>
          <IntegrationsConsumer />
        </IntegrationsProvider>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('');
    });
  });
});
