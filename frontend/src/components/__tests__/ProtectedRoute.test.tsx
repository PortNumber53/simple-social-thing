import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('ProtectedRoute', () => {
  it('renders fallback when not authenticated', () => {
    vi.resetModules();
    vi.doMock('../../contexts/AuthContext', () => {
      return {
        useAuth: () => ({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          login: vi.fn(),
          logout: vi.fn(),
          error: null,
        }),
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    return import('../ProtectedRoute').then(({ ProtectedRoute }) => {
    render(
      <ProtectedRoute fallback={<div>nope</div>}>
        <div>secret</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('nope')).toBeInTheDocument();
    });
  });

  it('renders loading when isLoading=true', async () => {
    vi.resetModules();
    vi.doMock('../../contexts/AuthContext', () => {
      return {
        useAuth: () => ({
          isAuthenticated: false,
          isLoading: true,
          user: null,
          login: vi.fn(),
          logout: vi.fn(),
          error: null,
        }),
      };
    });

    const { ProtectedRoute: PR } = await import('../ProtectedRoute');
    render(
      <PR>
        <div>secret</div>
      </PR>,
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
