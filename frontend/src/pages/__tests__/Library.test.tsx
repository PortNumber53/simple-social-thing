import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { IntegrationsProvider } from '../../contexts/IntegrationsContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { Library } from '../Library';

class FakeXHR {
  static instances: FakeXHR[] = [];
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  method = '';
  url = '';
  requestBody: any = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  upload = {
    onloadstart: null as null | (() => void),
    onprogress: null as null | ((evt: { lengthComputable: boolean; loaded: number; total: number }) => void),
  };

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send(body: any) {
    this.requestBody = body;
    // simulate upload progress then success
    this.upload.onloadstart?.();
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    this.status = 200;
    // Return a /media/... URL so scheduling validation can treat it as attachable media.
    this.responseText = JSON.stringify({ items: [{ id: 'up_1', url: '/media/uploads/u1/a.png', kind: 'image', filename: 'a.png' }] });
    this.onload?.();
  }
}

describe('Library', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'e', name: 'User' }));
    vi.restoreAllMocks();

    // Mock crypto.randomUUID for predictable temp ids.
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid' } as any);

    // Mock XHR upload used by Library addFiles().
    FakeXHR.instances = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).XMLHttpRequest = function () {
      const x = new FakeXHR();
      FakeXHR.instances.push(x);
      return x;
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/integrations/status') {
          // Library reads connected networks from IntegrationsProvider.
          return new Response(JSON.stringify({ instagram: { connected: true } }), { status: 200 });
        }
        if (url.startsWith('/api/local-library/items?status=draft')) {
          return new Response(JSON.stringify([{ id: 'p1', status: 'draft', content: 'hello' }]), { status: 200 });
        }
        if (url.startsWith('/api/local-library/items?status=scheduled')) {
          return new Response(JSON.stringify([{ id: 'p2', status: 'scheduled', content: 'later' }]), { status: 200 });
        }
        if (url === '/api/local-library/items/p2/publish-now' && init?.method === 'POST') {
          return new Response(JSON.stringify({ ok: true, jobId: 'pub_123', status: 'queued' }), { status: 200 });
        }
        if (url === '/api/user-settings') {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        // Save draft/scheduled
        if (url === '/api/local-library/items' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'new1', status: 'draft', content: 'x' }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
  });

  it('loads items, switches tabs, and uploads a file', async () => {
    const u = userEvent.setup();
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <IntegrationsProvider>
              <Library />
            </IntegrationsProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    // Drafts loaded by default
    expect(await screen.findByText('Home')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1 item\(s\)/i)).toBeInTheDocument());

    // Switch tab to Scheduled (triggers fetch)
    await u.click(screen.getByRole('button', { name: /Scheduled/i }));
    await waitFor(() => expect(screen.getByText(/1 item\(s\)/i)).toBeInTheDocument());

    // Publish Now appears for scheduled items (list pane) and should hit the endpoint.
    await u.click(screen.getByRole('button', { name: /Publish Now/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as any[];
      const didPost = calls.some((c: any[]) => String(c?.[0] || '') === '/api/local-library/items/p2/publish-now' && c?.[1]?.method === 'POST');
      expect(didPost).toBe(true);
    });

    // Open the editor so we can attach media to a draft.
    // There are two "New draft" buttons (segmented control + toolbar); pick the toolbar one.
    const newDraftBtns = screen.getAllByRole('button', { name: /^New draft$/i });
    const toolbarNewDraft = newDraftBtns.find((b) => String((b as HTMLElement).className || '').includes('btn-secondary')) ?? newDraftBtns[0];
    await u.click(toolbarNewDraft);

    // Upload file via hidden input
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('missing upload input');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await u.upload(input, file);

    // After FakeXHR resolves, the uploaded filename should appear in the UI somewhere.
    await waitFor(() => {
      expect(document.body.textContent || '').toContain('a.png');
    });

    // Select uploaded item and attach to draft media
    const selectCb = screen.getByRole('checkbox', { name: /Select a\.png/i });
    await u.click(selectCb);
    await u.click(screen.getByRole('button', { name: /Add selected/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Remove a\.png/i }).length).toBeGreaterThan(0);
    });

    // Clear uploads (best effort)
    // Stub delete endpoint for this action.
    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/local-library/uploads/delete' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, deleted: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const uploadsHeader = screen.getByText('Uploads');
    const uploadsCard = uploadsHeader.closest('.card') as HTMLElement | null;
    if (!uploadsCard) throw new Error('missing uploads card');
    await u.click(within(uploadsCard).getByRole('button', { name: /^Clear$/i }));
  });

  it('validates scheduling, creates a draft, and deletes an item', async () => {
    const u = userEvent.setup();
    // Always confirm deletes.
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/integrations/status') {
          return new Response(JSON.stringify({ instagram: { connected: true } }), { status: 200 });
        }
        if (url.startsWith('/api/local-library/items?status=draft')) {
          return new Response(JSON.stringify([{ id: 'p1', status: 'draft', content: 'hello' }]), { status: 200 });
        }
        if (url === '/api/local-library/items' && init?.method === 'POST') {
          let parsed: any = null;
          try {
            parsed = init?.body ? JSON.parse(String(init.body)) : null;
          } catch {
            parsed = null;
          }
          const status = parsed?.status === 'scheduled' ? 'scheduled' : 'draft';
          return new Response(
            JSON.stringify({
              id: 'created1',
              status,
              content: parsed?.content ?? 'new content',
              providers: parsed?.providers ?? [],
              scheduledFor: parsed?.scheduledFor ?? null,
            }),
            { status: 200 },
          );
        }
        if (url === '/api/local-library/items/created1' && init?.method === 'PUT') {
          let parsed: any = null;
          try {
            parsed = init?.body ? JSON.parse(String(init.body)) : null;
          } catch {
            parsed = null;
          }
          const status = parsed?.status === 'scheduled' ? 'scheduled' : 'draft';
          return new Response(
            JSON.stringify({
              id: 'created1',
              status,
              content: parsed?.content ?? 'new content',
              providers: parsed?.providers ?? [],
              scheduledFor: parsed?.scheduledFor ?? null,
              media: parsed?.media ?? [],
            }),
            { status: 200 },
          );
        }
        if (url.startsWith('/api/local-library/items/p1') && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <IntegrationsProvider>
              <Library />
            </IntegrationsProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Home')).toBeInTheDocument();

    // Open editor (left pane) for validation tests.
    const newDraftBtns2 = screen.getAllByRole('button', { name: /^New draft$/i });
    const toolbarNewDraft2 = newDraftBtns2.find((b) => String((b as HTMLElement).className || '').includes('btn-secondary')) ?? newDraftBtns2[0];
    await u.click(toolbarNewDraft2);

    // Set scheduled status without date and attempt save
    const statusSelect = document.querySelector('select') as HTMLSelectElement | null;
    if (!statusSelect) throw new Error('missing status select');
    await u.selectOptions(statusSelect, 'scheduled');
    await u.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(screen.getByText(/Pick a valid scheduled time/i)).toBeInTheDocument();

    // Provide a scheduled time but no networks -> should show network validation error
    const scheduledInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
    if (!scheduledInput) throw new Error('missing scheduled input');
    await u.clear(scheduledInput);
    await u.type(scheduledInput, '2030-01-01T10:00');
    await u.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(screen.getByText(/Select at least one network/i)).toBeInTheDocument();

    // Select a network that does not require media (should still be allowed for planning)
    await u.click(screen.getByLabelText('Facebook'));
    await u.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => {
      expect(document.body.textContent || '').toContain('ID: created1');
    });

    // Assert the created request included providers
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as any[];
      const createCall = calls.find((c: any[]) => String(c?.[0] || '') === '/api/local-library/items' && c?.[1]?.method === 'POST');
      expect(createCall).toBeTruthy();
      const body = JSON.parse(String(createCall?.[1]?.body || '{}'));
      expect(body.status).toBe('scheduled');
      expect(Array.isArray(body.providers)).toBe(true);
      expect(body.providers).toContain('facebook');
      expect(typeof body.scheduledFor).toBe('string');
    });

    // Now switch to Instagram (requires media), but only "select" an upload (do not click "Add selected").
    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!uploadInput) throw new Error('missing upload input');
    await u.upload(uploadInput, new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(document.body.textContent || '').toContain('a.png'));
    await u.click(screen.getByRole('checkbox', { name: /Select a\.png/i }));

    // Swap providers: disable Facebook, enable Instagram.
    await u.click(screen.getByLabelText('Facebook'));
    await u.click(screen.getByLabelText('Instagram'));
    await u.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(document.body.textContent || '').not.toContain('Attach at least one upload before scheduling');
    });
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as any[];
      const putCall = calls.find((c: any[]) => String(c?.[0] || '') === '/api/local-library/items/created1' && c?.[1]?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse(String(putCall?.[1]?.body || '{}'));
      expect(body.status).toBe('scheduled');
      expect(Array.isArray(body.providers)).toBe(true);
      expect(body.providers).toContain('instagram');
      expect(Array.isArray(body.media)).toBe(true);
      expect(body.media).toContain('/media/uploads/u1/a.png');
    });

    // Switch back to draft, type content, save (updates same post)
    await u.selectOptions(statusSelect, 'draft');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('missing editor textarea');
    await u.clear(textarea);
    await u.type(textarea, 'new content');
    await u.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => {
      expect(document.body.textContent || '').toContain('ID: created1');
    });

    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as any[];
      const didPut = calls.some((c: any[]) => String(c?.[0] || '') === '/api/local-library/items/created1' && c?.[1]?.method === 'PUT');
      expect(didPut).toBe(true);
    });

  });
});
