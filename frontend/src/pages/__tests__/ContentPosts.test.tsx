import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';

// Mock integrations context to control connected providers without depending on network.
vi.mock('../../contexts/IntegrationsContext', () => {
  return {
    useIntegrations: () => ({
      connectedProviders: ['instagram', 'tiktok', 'youtube', 'pinterest', 'facebook'],
      facebookPages: [{ id: 'pg1', name: 'Page 1', tasks: ['CREATE_CONTENT'], canPost: true }],
    }),
  };
});

import { ContentPosts } from '../ContentPosts';

describe('ContentPosts', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();

    // Prevent real WS connections in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = class {
      onmessage: any = null;
      onerror: any = null;
      constructor(_url: string) {}
      close() {}
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/posts/publish') {
          return new Response(JSON.stringify({ jobId: 'job1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it('shows validation errors for missing caption and missing required media', async () => {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ContentPosts />
        </AuthProvider>
      </MemoryRouter>,
    );

    await u.click(screen.getByRole('button', { name: /^Publish$/i }));
    expect(screen.getByText(/Please write a caption/i)).toBeInTheDocument();

    // Provide caption; (no label association in markup) so select the textarea.
    const captionBox = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!captionBox) throw new Error('missing caption textarea');
    await u.type(captionBox, 'hello');
    await u.click(screen.getByRole('button', { name: /^Publish$/i }));
    expect(screen.getByText(/Instagram publishing requires at least one image/i)).toBeInTheDocument();
  });

  it('uploads a media file and starts publish request', async () => {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ContentPosts />
        </AuthProvider>
      </MemoryRouter>,
    );

    const captionBox = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!captionBox) throw new Error('missing caption textarea');
    await u.type(captionBox, 'hello');

    // Upload an image + a video to satisfy Instagram + TikTok/YouTube + Pinterest validation.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('missing file input');
    await u.upload(input, [
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'v.mp4', { type: 'video/mp4' }),
    ]);

    await u.click(screen.getByRole('button', { name: /^Publish$/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as any[];
      const didCallPublish = calls.some((c) => c?.[0] === '/api/posts/publish');
      expect(didCallPublish).toBe(true);
    });

    expect(screen.getByText(/Publishing in background \(job job1\)/i)).toBeInTheDocument();
  });
});
