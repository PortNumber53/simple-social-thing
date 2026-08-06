import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { Billing } from '../Billing';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Billing page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();
  });

  it('renders billing plans and subscription info', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/billing/plans')) {
          return new Response(
            JSON.stringify([
              { id: 'free', name: 'Free', priceCents: 0, currency: 'usd', interval: 'month', isActive: true },
              { id: 'pro', name: 'Pro', priceCents: 10000, currency: 'usd', interval: 'month', isActive: true },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('/api/billing/subscription/')) {
          return new Response(
            JSON.stringify({ id: 'sub1', userId: 'u1', planId: 'free', status: 'active', cancelAtPeriodEnd: false }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('/api/billing/invoices/')) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/user-settings')) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    renderWithProviders(<Billing />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Billing/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Free/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error message when API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'server_error' }), { status: 500 });
      }),
    );

    renderWithProviders(<Billing />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load billing data/i)).toBeInTheDocument();
    });
  });
});
