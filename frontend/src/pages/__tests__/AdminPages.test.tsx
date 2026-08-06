import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { IntegrationsProvider } from '../../contexts/IntegrationsContext';
import { ThemeProvider } from '../../contexts/ThemeContext';

import { AdminAnalytics } from '../AdminAnalytics';
import { AdminSettings } from '../AdminSettings';
import { AdminUsers } from '../AdminUsers';
import { AdminBilling } from '../AdminBilling';
import { AdminCustomPlanRequests } from '../AdminCustomPlanRequests';

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

describe('Admin pages', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'admin1', email: 'admin@test.com', name: 'Admin' }));
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/billing/plans')) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/billing/custom-plan-requests')) {
          return new Response(JSON.stringify({ requests: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/integrations/status')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (url.endsWith('/api/integrations/suno/api-key')) {
          return new Response(JSON.stringify({ ok: true, value: { apiKey: '' } }), { status: 200 });
        }
        if (url.endsWith('/api/user-settings')) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });

  it('renders AdminAnalytics with heading and info banner', () => {
    renderWithProviders(<AdminAnalytics />);
    expect(screen.getByRole('heading', { name: /System Analytics/i })).toBeInTheDocument();
    expect(screen.getByText(/Analytics dashboard coming soon/i)).toBeInTheDocument();
  });

  it('renders AdminSettings with heading and info banner', () => {
    renderWithProviders(<AdminSettings />);
    const headings = screen.getAllByRole('heading', { name: /System Settings/i });
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/System settings panel coming soon/i)).toBeInTheDocument();
  });

  it('renders AdminUsers with heading and info banner', () => {
    renderWithProviders(<AdminUsers />);
    const headings = screen.getAllByRole('heading', { name: /User Management/i });
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/User management functionality coming soon/i)).toBeInTheDocument();
  });

  it('renders AdminBilling and loads plans', async () => {
    renderWithProviders(<AdminBilling />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Plan Management/i })).toBeInTheDocument();
    });
  });

  it('renders AdminCustomPlanRequests and loads requests', async () => {
    renderWithProviders(<AdminCustomPlanRequests />);
    expect(screen.getByRole('heading', { name: /Custom Plan Requests/i })).toBeInTheDocument();
  });
});
