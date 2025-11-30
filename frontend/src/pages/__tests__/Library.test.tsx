import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
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
    this.responseText = JSON.stringify({ items: [{ id: 'up_1', url: 'https://x', kind: 'image', filename: 'a.png' }] });
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
        if (url.startsWith('/api/local-library/items?status=draft')) {
          return new Response(JSON.stringify([{ id: 'p1', status: 'draft', content: 'hello' }]), { status: 200 });
        }
        if (url.startsWith('/api/local-library/items?status=scheduled')) {
          return new Response(JSON.stringify([{ id: 'p2', status: 'scheduled', content: 'later' }]), { status: 200 });
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
        <AuthProvider>
          <Library />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Drafts loaded by default
    expect(await screen.findByRole('heading', { name: /Library/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1 item\(s\)/i)).toBeInTheDocument());

    // Switch tab to Scheduled (triggers fetch)
    await u.click(screen.getByRole('button', { name: /Scheduled/i }));
    await waitFor(() => expect(screen.getByText(/1 item\(s\)/i)).toBeInTheDocument());

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
    const uploadsCard = uploadsHeader.closest('.card');
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
        if (url.startsWith('/api/local-library/items?status=draft')) {
          return new Response(JSON.stringify([{ id: 'p1', status: 'draft', content: 'hello' }]), { status: 200 });
        }
        if (url === '/api/local-library/items' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'created1', status: 'draft', content: 'new content' }), { status: 200 });
        }
        if (url.startsWith('/api/local-library/items/p1') && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <Library />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /Library/i })).toBeInTheDocument();

    // Set scheduled status without date and attempt save
    const statusSelect = document.querySelector('select') as HTMLSelectElement | null;
    if (!statusSelect) throw new Error('missing status select');
    await u.selectOptions(statusSelect, 'scheduled');
    await u.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(screen.getByText(/Pick a valid scheduled time/i)).toBeInTheDocument();

    // Switch back to draft, type content, save create
    await u.selectOptions(statusSelect, 'draft');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('missing editor textarea');
    await u.clear(textarea);
    await u.type(textarea, 'new content');
    await u.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => {
      expect(document.body.textContent || '').toContain('ID: created1');
    });

    // Delete the existing list item (p1) if rendered
    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i });
    await u.click(deleteButtons[0]);
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls as any[];
      const didDelete = calls.some((c: any[]) => String(c?.[0] || '').includes('/api/local-library/items/') && c?.[1]?.method === 'DELETE');
      expect(didDelete).toBe(true);
    });
  });
});
