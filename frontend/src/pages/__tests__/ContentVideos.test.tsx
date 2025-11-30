import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ContentVideos } from '../ContentVideos';

describe('ContentVideos', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
  });

  it('accepts a video file and shows queued status after publish', async () => {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ContentVideos />
        </AuthProvider>
      </MemoryRouter>,
    );

    const publish = screen.getByRole('button', { name: /publish/i });
    expect(publish).toBeDisabled();

    const file = new File(['x'], 'video.mp4', { type: 'video/mp4' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('missing file input');
    await u.upload(input, file);
    expect(publish).toBeEnabled();

    await u.click(publish);
    expect(screen.getByText(/Uploading video/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 950));
    expect(screen.getByText(/Video queued/i)).toBeInTheDocument();
  });
});
