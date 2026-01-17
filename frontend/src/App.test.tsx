import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { IntegrationsProvider } from './contexts/IntegrationsContext';
import { ThemeProvider } from './contexts/ThemeContext';

function renderApp() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <IntegrationsProvider>
          <App />
        </IntegrationsProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe('App routing', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/integrations/status')) return new Response(JSON.stringify({}), { status: 200 });
        if (url.endsWith('/api/user-settings')) return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        if (url.includes('/api/library/items')) return new Response(JSON.stringify([]), { status: 200 });
        if (url.endsWith('/api/integrations/suno/tracks')) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it('renders home on /', () => {
    window.history.replaceState({}, '', '/');
    renderApp();
    expect(screen.getByRole('heading', { name: /Simple Social Thing/i })).toBeInTheDocument();
  });

  it('redirects unknown route to home', () => {
    window.history.replaceState({}, '', '/nope');
    renderApp();
    expect(screen.getByRole('heading', { name: /Simple Social Thing/i })).toBeInTheDocument();
  });

  it('redirects protected route to home when logged out', async () => {
    window.history.replaceState({}, '', '/content/published');
    renderApp();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Simple Social Thing/i })).toBeInTheDocument());
  });

  it('renders protected route content when logged in', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    window.history.replaceState({}, '', '/content/published');
    renderApp();
    expect(await screen.findByRole('heading', { name: /Published/i })).toBeInTheDocument();
  });
});
