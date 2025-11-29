import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';

type LocalPost = {
  id: string;
  content?: string | null;
  status: 'draft' | 'scheduled' | 'published' | string;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const Library: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<'draft' | 'scheduled'>('draft');
  const [items, setItems] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LocalPost | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftStatus, setDraftStatus] = useState<'draft' | 'scheduled'>('draft');
  const [scheduledForLocal, setScheduledForLocal] = useState<string>('');

  const load = async (status: 'draft' | 'scheduled') => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/local-library/items?status=${encodeURIComponent(status)}`, { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError('Failed to load local library.');
        return;
      }
      setItems(Array.isArray(data) ? (data as LocalPost[]) : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to load local library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(statusFilter);
  }, [statusFilter]);

  const openNew = () => {
    setEditing(null);
    setDraftText('');
    setDraftStatus('draft');
    setScheduledForLocal('');
    setEditorOpen(true);
  };

  const openEdit = (p: LocalPost) => {
    setEditing(p);
    setDraftText((p.content || '').toString());
    setDraftStatus((p.status === 'scheduled' ? 'scheduled' : 'draft'));
    if (p.scheduledFor) {
      const d = new Date(p.scheduledFor);
      const pad = (n: number) => String(n).padStart(2, '0');
      const local =
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setScheduledForLocal(local);
    } else {
      setScheduledForLocal('');
    }
    setEditorOpen(true);
  };

  const toIsoOrNull = (localValue: string): string | null => {
    const v = localValue.trim();
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const save = async () => {
    const content = draftText.trim();
    const scheduledForIso = toIsoOrNull(scheduledForLocal);
    if (draftStatus === 'scheduled' && !scheduledForIso) {
      setError('Pick a valid scheduled time.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const res = await fetch(`/api/local-library/items/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, status: draftStatus, scheduledFor: scheduledForIso }),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setError('Failed to save.');
          return;
        }
        const updated = data as LocalPost;
        setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const res = await fetch(`/api/local-library/items`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, status: draftStatus, scheduledFor: scheduledForIso }),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setError('Failed to create.');
          return;
        }
        const created = data as LocalPost;
        setItems((prev) => [created, ...prev]);
      }

      setEditorOpen(false);
      setEditing(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: LocalPost) => {
    const ok = window.confirm('Delete this item?');
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/local-library/items/${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        setError('Failed to delete.');
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to delete.');
    }
  };

  const emptyState = useMemo(() => {
    if (statusFilter === 'draft') return 'No drafts yet. Create one to start planning your publishing.';
    return 'No scheduled items yet.';
  }, [statusFilter]);

  return (
    <Layout>
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Library</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            Drafts and scheduled content you manage locally, to be published later.
          </p>
        </header>

        <div className="card p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setStatusFilter('draft')}
                className={[
                  'px-3 py-2 text-sm',
                  statusFilter === 'draft'
                    ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-white/70 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40',
                ].join(' ')}
              >
                Drafts
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('scheduled')}
                className={[
                  'px-3 py-2 text-sm border-l border-slate-200 dark:border-slate-700',
                  statusFilter === 'scheduled'
                    ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-white/70 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40',
                ].join(' ')}
              >
                Scheduled
              </button>
            </div>

            <div className="sm:ml-auto flex items-center gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => void load(statusFilter)} disabled={loading}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button" className="btn btn-primary" onClick={openNew}>
                New draft
              </button>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 dark:text-red-300">{error}</div>}
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-slate-200/60 dark:divide-slate-700/40">
            {items.length === 0 ? (
              <div className="p-8 text-slate-500 dark:text-slate-400">{emptyState}</div>
            ) : (
              items.map((p) => {
                const scheduledLabel = p.scheduledFor ? new Date(p.scheduledFor).toLocaleString() : '—';
                const createdLabel = p.createdAt ? new Date(p.createdAt).toLocaleString() : '';
                const preview = (p.content || '').trim();
                return (
                  <div key={p.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                          {p.status}
                        </span>
                        {p.status === 'scheduled' && (
                          <span className="text-xs text-slate-600 dark:text-slate-300">Scheduled: {scheduledLabel}</span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-slate-900 dark:text-slate-50 break-words">
                        {preview ? preview : <span className="text-slate-500 dark:text-slate-400">No content</span>}
                      </div>
                      {createdLabel && (
                        <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">Created: {createdLabel}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button type="button" className="btn btn-secondary" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <a
                        className="btn btn-ghost"
                        href={`/content/posts?caption=${encodeURIComponent((p.content || '').toString())}`}
                        title="Open in publisher (caption-only)"
                      >
                        Open publisher
                      </a>
                      <button type="button" className="btn btn-ghost text-red-600 hover:text-red-700" onClick={() => void remove(p)}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {editorOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setEditorOpen(false)} aria-hidden="true" />
            <div className="relative w-full max-w-2xl card p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {editing ? 'Edit item' : 'New draft'}
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setEditorOpen(false)} aria-label="Close">
                  Close
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Content</label>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
                  placeholder="Write your caption / notes…"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
                  <select
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value === 'scheduled' ? 'scheduled' : 'draft')}
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Scheduled for</label>
                  <input
                    type="datetime-local"
                    value={scheduledForLocal}
                    onChange={(e) => setScheduledForLocal(e.target.value)}
                    disabled={draftStatus !== 'scheduled'}
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => setEditorOpen(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300">
                Scheduling is stored in the app, but automated scheduled publishing is not wired up yet.
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
