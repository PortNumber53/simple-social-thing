import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { InstagramAgent } from '../InstagramAgent';

describe('InstagramAgent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/instagram-agent/account') {
        return new Response(JSON.stringify({ id: 'ig-1', username: 'coffee', followers_count: 120, follows_count: 30, media_count: 9 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/instagram-agent/generate') {
        return new Response(JSON.stringify({ ok: true, content: 'A bright new roast. #coffee' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  it('shows account information and generates editable content', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><InstagramAgent /></MemoryRouter>);

    expect(await screen.findByText('@coffee')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();

    await user.type(screen.getByLabelText('What should the post be about?'), 'a new coffee roast');
    await user.click(screen.getByRole('checkbox', { name: 'Stream output' }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.getByLabelText('Generated content')).toHaveValue('A bright new roast. #coffee'));
    expect(screen.getByRole('link', { name: 'Use in composer' })).toHaveAttribute('href', expect.stringContaining('/content/posts?caption='));
  });
});
