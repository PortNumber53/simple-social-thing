import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
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
        <ThemeProvider>
          <AuthProvider>
            <ContentVideos />
          </AuthProvider>
        </ThemeProvider>
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
    await waitFor(() => {
      expect(screen.getByText(/Video queued/i)).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('does not render video element for unsafe preview URLs', async () => {
    // Force URL.createObjectURL to return a javascript: URI so the guard in
    // ContentVideos.tsx (previewUrl && isSafeMediaSrc(previewUrl)) is actually
    // exercised with an unsafe value, rather than only checking the empty-state.
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('javascript:alert(1)');
    const u = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <ContentVideos />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const file = new File(['x'], 'video.mp4', { type: 'video/mp4' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('missing file input');
    await u.upload(input, file);

    // The unsafe preview URL must be set in state, yet the <video> element must
    // not be rendered because isSafeMediaSrc rejects the javascript: scheme.
    expect(createObjectURLSpy).toHaveBeenCalledWith(file);
    expect(container.querySelector('video')).toBeNull();
    createObjectURLSpy.mockRestore();
  });

  it('renders video element for safe (blob:) preview URLs', async () => {
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:http://localhost/abc');
    const u = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <ContentVideos />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const file = new File(['x'], 'video.mp4', { type: 'video/mp4' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('missing file input');
    await u.upload(input, file);

    // A safe blob: URL should produce a <video> element.
    expect(container.querySelector('video')).not.toBeNull();
    createObjectURLSpy.mockRestore();
  });
});
