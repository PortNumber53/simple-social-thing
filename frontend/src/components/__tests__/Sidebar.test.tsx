import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { SidebarProvider } from '../../contexts/SidebarContext';
import { Sidebar } from '../Sidebar';

function renderWithProviders(ui: React.ReactElement, { route = '/dashboard' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <SidebarProvider>{ui}</SidebarProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/user-settings')) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });

  it('renders navigation links', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Integrations/i)).toBeInTheDocument();
    expect(screen.getByText(/Compose/i)).toBeInTheDocument();
  });
});
