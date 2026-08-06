import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { IntegrationsProvider } from '../../contexts/IntegrationsContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ContentVideoEditor } from '../ContentVideoEditor';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>
          <IntegrationsProvider>{ui}</IntegrationsProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('ContentVideoEditor page', () => {
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
        if (url.includes('/api/uploads/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });

  it('renders the video editor with heading', async () => {
    renderWithProviders(<ContentVideoEditor />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Video Editor/i })).toBeInTheDocument();
    });
  });
});
