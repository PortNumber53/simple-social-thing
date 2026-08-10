import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { SidebarProvider } from '../../contexts/SidebarContext';
import { TopBar } from '../TopBar';
import { NotificationsPopover } from '../NotificationsPopover';

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

describe('TopBar', () => {
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

  it('renders top bar with user info', () => {
    renderWithProviders(<TopBar />);
  });

  it('prevents URL redirection via malicious imageUrl', () => {
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u1', email: 'e', name: 'User', imageUrl: 'javascript:window.location="//evil.com"' }),
    );
    renderWithProviders(<TopBar />);
    const img = document.querySelector('img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    if (img) {
      expect(img.src).not.toContain('javascript:');
      expect(img.src).not.toContain('evil.com');
    }
  });
});

describe('NotificationsPopover', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
  });

  it('renders without crashing', () => {
    renderWithProviders(<NotificationsPopover />);
  });
});
