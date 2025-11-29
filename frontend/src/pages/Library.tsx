import React, { useEffect, useMemo, useRef, useState } from 'react';
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

type UploadPreview = {
  id: string;
  file: File;
  url: string;
  kind: 'image' | 'video' | 'other';
};

export const Library: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<'draft' | 'scheduled'>('draft');
  const [items, setItems] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<LocalPost | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftStatus, setDraftStatus] = useState<'draft' | 'scheduled'>('draft');
  const [scheduledForLocal, setScheduledForLocal] = useState<string>('');
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [uploads, setUploads] = useState<UploadPreview[]>([]);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsRef = useRef<UploadPreview[]>([]);
  const [dragUploadId, setDragUploadId] = useState<string | null>(null);
  const [dragOverUploadId, setDragOverUploadId] = useState<string | null>(null);
  const [selectedUploadIds, setSelectedUploadIds] = useState<Set<string>>(() => new Set());
  const [draftMediaIds, setDraftMediaIds] = useState<string[]>([]);
  const [dragOverDraftMedia, setDragOverDraftMedia] = useState(false);

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

  const resetEditorToNewDraft = () => {
    setEditing(null);
    setDraftText('');
    setDraftStatus('draft');
    setScheduledForLocal('');
    setDraftMediaIds([]);
  };

  const addFiles = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploads((prev) => {
      const next = [...prev];
      for (const f of arr) {
        const type = (f.type || '').toLowerCase();
        const kind: UploadPreview['kind'] =
          type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : 'other';
        next.push({ id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f), kind });
      }
      return next;
    });
  };

  const clearUploads = () => {
    setUploads((prev) => {
      for (const u of prev) URL.revokeObjectURL(u.url);
      return [];
    });
    setSelectedUploadIds(new Set());
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const removeUpload = (id: string) => {
    setUploads((prev) => {
      const u = prev.find((x) => x.id === id);
      if (u) URL.revokeObjectURL(u.url);
      return prev.filter((x) => x.id !== id);
    });
    setSelectedUploadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDraftMediaIds((prev) => prev.filter((x) => x !== id));
  };

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    return () => {
      // Cleanup object URLs on unmount.
      for (const u of uploadsRef.current) URL.revokeObjectURL(u.url);
    };
  }, []);

  const reorderUploads = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    setUploads((prev) => {
      const fromIdx = prev.findIndex((u) => u.id === fromId);
      const toIdx = prev.findIndex((u) => u.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const parseUploadIdsFromDataTransfer = (dt: DataTransfer): string[] => {
    const raw = dt.getData('application/x-sst-upload-ids');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string') as string[];
    } catch { /* ignore */ }
    return [];
  };

  const attachUploadsToDraft = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setDraftMediaIds((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
      return next;
    });
  };

  const removeDraftMedia = (id: string) => {
    setDraftMediaIds((prev) => prev.filter((x) => x !== id));
  };

  const uploadById = useMemo(() => {
    const m = new Map<string, UploadPreview>();
    for (const u of uploads) m.set(u.id, u);
    return m;
  }, [uploads]);

  const draftMedia = useMemo(() => {
    return draftMediaIds.map((id) => uploadById.get(id)).filter((x): x is UploadPreview => !!x);
  }, [draftMediaIds, uploadById]);

  const scrollToEditor = () => {
    const el = editorRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openNew = () => {
    resetEditorToNewDraft();
    scrollToEditor();
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
    setDraftMediaIds([]); // local-only for now
    scrollToEditor();
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
        // If the update moves the post between tabs, switch tabs.
        if (updated.status === 'draft' || updated.status === 'scheduled') {
          if (updated.status !== statusFilter) setStatusFilter(updated.status);
        }
        setItems((prev) => {
          if (updated.status !== statusFilter) return prev.filter((p) => p.id !== updated.id);
          return prev.map((p) => (p.id === updated.id ? updated : p));
        });
        setEditing(updated);
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
        if (created.status === 'draft' || created.status === 'scheduled') {
          if (created.status !== statusFilter) setStatusFilter(created.status);
        }
        setItems((prev) => (created.status === statusFilter ? [created, ...prev] : prev));
        setEditing(created);
      }
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

        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6 items-start">
          {/* Editor (always visible) */}
          <div ref={editorRef} className="card p-5 space-y-4 xl:sticky xl:top-24">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {editing ? 'Edit draft' : 'New draft'}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {editing ? `ID: ${editing.id}` : 'Create local content you can reuse and schedule later.'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={openNew}
                disabled={saving}
                title="Clear the form"
              >
                New
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Content</label>
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={8}
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

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Media</label>
                <div className="flex items-center gap-2">
                  {selectedUploadIds.size > 0 && (
                    <button
                      type="button"
                      className="text-xs underline text-slate-600 dark:text-slate-300"
                      onClick={() => attachUploadsToDraft(Array.from(selectedUploadIds))}
                    >
                      Add selected ({selectedUploadIds.size})
                    </button>
                  )}
                  {draftMediaIds.length > 0 && (
                    <button
                      type="button"
                      className="text-xs underline text-slate-600 dark:text-slate-300"
                      onClick={() => setDraftMediaIds([])}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div
                className={[
                  'rounded-lg border border-dashed p-3 text-sm',
                  dragOverDraftMedia
                    ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-900/10'
                    : 'border-slate-300/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/20',
                ].join(' ')}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('application/x-sst-upload-ids')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setDragOverDraftMedia(true);
                }}
                onDragLeave={() => setDragOverDraftMedia(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  const ids = parseUploadIdsFromDataTransfer(e.dataTransfer);
                  attachUploadsToDraft(ids.length > 0 ? ids : Array.from(selectedUploadIds));
                  setDragOverDraftMedia(false);
                }}
              >
                <div className="text-slate-700 dark:text-slate-200">
                  Drop selected uploads here to attach them to this draft.
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Tip: select multiple thumbnails, then drag any one of them onto this area.
                </div>
              </div>

              {draftMedia.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {draftMedia.map((u) => (
                    <div key={u.id} className="card p-0 overflow-hidden">
                      <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                        {u.kind === 'image' ? (
                          <img src={u.url} alt={u.file.name} className="w-full h-full object-cover" />
                        ) : u.kind === 'video' ? (
                          <video src={u.url} className="w-full h-full object-cover" muted playsInline />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <span className="text-sm">File</span>
                          </div>
                        )}
                        <button
                          type="button"
                          className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs hover:bg-slate-900/80"
                          aria-label={`Remove ${u.file.name}`}
                          onClick={() => removeDraftMedia(u.id)}
                        >
                          ×
                        </button>
                        <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/60 text-white text-[11px] px-2 py-1 truncate">
                          {u.file.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  resetEditorToNewDraft();
                  setError(null);
                }}
                disabled={saving}
              >
                Clear
              </button>
              {editing && (
                <a
                  className="btn btn-secondary"
                  href={`/content/posts?caption=${encodeURIComponent(draftText.trim())}`}
                  title="Open in publisher (caption-only)"
                >
                  Open publisher
                </a>
              )}
            </div>

            {error && <div className="text-sm text-red-600 dark:text-red-300">{error}</div>}
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Scheduling is stored in the app, but automated scheduled publishing is not wired up yet.
            </div>
          </div>

          {/* List */}
          <div className="space-y-4">
            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Uploads</div>
                <div className="flex items-center gap-2">
                  {uploads.length > 0 && (
                    <button type="button" className="btn btn-ghost" onClick={clearUploads}>
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    Add files
                  </button>
              </div>
            </div>

              <div
                className="rounded-lg border border-dashed border-slate-300/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/20 p-4"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  // If we're dragging an existing thumbnail, ignore here (reorder handled on thumbnails).
                  if (e.dataTransfer.types.includes('application/x-sst-upload-ids')) return;
                  addFiles(e.dataTransfer.files);
                }}
              >
              <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="text-sm text-slate-700 dark:text-slate-200">
                    Drag & drop files here, or click <span className="font-medium">Add files</span>.
                  </div>
                  <div className="sm:ml-auto text-xs text-slate-500 dark:text-slate-400">
                    Images & videos · multiple files
                  </div>
            </div>
          </div>

              {uploads.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
                  {uploads.map((u) => (
                    <div
                      key={u.id}
                      className={[
                        'card p-0 overflow-hidden',
                        dragOverUploadId === u.id && dragUploadId && dragUploadId !== u.id ? 'ring-2 ring-primary-500' : '',
                        dragUploadId === u.id ? 'opacity-60' : '',
                      ].join(' ')}
                      draggable
                      onDragStart={(e) => {
                        const ids =
                          selectedUploadIds.size > 0 && selectedUploadIds.has(u.id)
                            ? Array.from(selectedUploadIds)
                            : [u.id];
                        setDragUploadId(u.id);
                        setDragOverUploadId(null);
                        e.dataTransfer.effectAllowed = ids.length > 1 ? 'copy' : 'move';
                        try {
                          e.dataTransfer.setData('application/x-sst-upload-ids', JSON.stringify(ids));
                          e.dataTransfer.setData('text/plain', ids.join(','));
                        } catch { /* ignore */ }
                      }}
                      onDragEnd={() => {
                        setDragUploadId(null);
                        setDragOverUploadId(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragUploadId || dragUploadId === u.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverUploadId(u.id);
                      }}
                      onDragLeave={() => {
                        setDragOverUploadId((prev) => (prev === u.id ? null : prev));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const ids = parseUploadIdsFromDataTransfer(e.dataTransfer);
                        if (ids.length !== 1) return; // only reorder single-item drags
                        reorderUploads(ids[0], u.id);
                        setDragOverUploadId(null);
                      }}
                      title="Drag to reorder"
                    >
                      <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                        {u.kind === 'image' ? (
                          <img src={u.url} alt={u.file.name} className="w-full h-full object-cover" />
                        ) : u.kind === 'video' ? (
                          <video src={u.url} className="w-full h-full object-cover" muted playsInline />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <span className="text-sm">File</span>
                          </div>
                        )}
                        <label
                          className="absolute top-2 left-2 z-10 inline-flex items-center gap-2 rounded-md bg-white/85 dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 text-xs px-2 py-1 border border-slate-200/70 dark:border-slate-700/60"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedUploadIds.has(u.id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedUploadIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(u.id);
                                else next.delete(u.id);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                            aria-label={`Select ${u.file.name}`}
                          />
                        </label>

                        <button
                          type="button"
                          className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs hover:bg-slate-900/80"
                          aria-label={`Remove ${u.file.name}`}
                          onClick={() => removeUpload(u.id)}
                        >
                          ×
                        </button>
                        <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/60 text-white text-[11px] px-2 py-1 truncate">
                          {u.file.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40 flex flex-wrap items-center gap-2">
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

                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {loading ? 'Loading…' : `${items.length} item(s)`}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <button type="button" className="btn btn-secondary" onClick={() => void load(statusFilter)} disabled={loading}>
                    Refresh
                  </button>
                </div>
              </div>
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
          </div>
        </div>
      </div>
    </Layout>
  );
};
