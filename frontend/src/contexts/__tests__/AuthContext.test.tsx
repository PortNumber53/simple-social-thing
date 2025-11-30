import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../AuthContext';

function AuthConsumer() {
  const { user, isAuthenticated, login, logout, error } = useAuth();
  return (
    <div>
      <div data-testid="is-auth">{String(isAuthenticated)}</div>
      <div data-testid="user-id">{user?.id ?? ''}</div>
      <div data-testid="user-name">{user?.name ?? ''}</div>
      <div data-testid="error">{error ?? ''}</div>
      <button
        type="button"
        onClick={() =>
          login({ id: 'u1', email: 'e@example.com', name: 'Test User', imageUrl: 'x' })
        }
      >
        login
      </button>
      <button type="button" onClick={() => logout()}>
        logout
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ ok: true, data: { a: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    // JSDOM location is partially read-only; replace with a mutable stub.
    // We only care that AuthProvider attempts to set `href` on success.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '/', search: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('hydrates user synchronously from localStorage and triggers settings cache refresh', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u0', email: 'a', name: 'Alice' }));
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId('is-auth')).toHaveTextContent('true');
    expect(screen.getByTestId('user-id')).toHaveTextContent('u0');
    expect(screen.getByTestId('user-name')).toHaveTextContent('Alice');

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user-settings', { credentials: 'include' });
    });
  });

  it('clears invalid stored user JSON', () => {
    localStorage.setItem('user', '{');
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(localStorage.getItem('user')).toBeNull();
    expect(screen.getByTestId('is-auth')).toHaveTextContent('false');
  });

  it('login stores user and also tries to cache user_settings', async () => {
    const u = userEvent.setup();
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await u.click(screen.getByRole('button', { name: 'login' }));
    expect(screen.getByTestId('is-auth')).toHaveTextContent('true');
    expect(localStorage.getItem('user')).toContain('"id":"u1"');

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/user-settings', { credentials: 'include' });
    });
  });

  it('logout clears user and cached user_settings', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'u0', email: 'a', name: 'Alice' }));
    localStorage.setItem('user_settings', JSON.stringify({ k: 1 }));

    const u = userEvent.setup();
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId('is-auth')).toHaveTextContent('true');

    await u.click(screen.getByRole('button', { name: 'logout' }));
    expect(screen.getByTestId('is-auth')).toHaveTextContent('false');
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('user_settings')).toBeNull();
  });

  it('processes oauth callback from query param and redirects to /dashboard', async () => {
    // Replace search so AuthProvider effect runs.
    const oauthPayload = encodeURIComponent(
      JSON.stringify({ success: true, user: { id: 'u2', email: 'e', name: 'Bob', imageUrl: '' } }),
    );
    (window.location as any).search = `?oauth=${oauthPayload}`;

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-auth')).toHaveTextContent('true');
    });
    expect(localStorage.getItem('user')).toContain('"id":"u2"');
    // Redirect performed by setting location.href
    expect(String((window.location as any).href)).toBe('/dashboard');
  });
});
