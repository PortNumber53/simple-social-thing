import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';

type LibraryItem = {
  id: string;
  network: string;
  contentType: string;
  title?: string | null;
  permalinkUrl?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  postedAt?: string | null;
  views?: number | null;
  likes?: number | null;
};

export const Library: React.FC = () => {
  const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const [network, setNetwork] = useState<string>('');
  const [contentType, setContentType] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState<string>('');

  const [allItems, setAllItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState<boolean>(false);

  const normalizeText = (s: string) => s.trim().toLowerCase();

  const filteredItems = useMemo(() => {
    const networkFilter = normalizeText(network);
    const typeFilter = normalizeText(contentType);
    const qFilter = normalizeText(q);

    const fromTs = from ? new Date(`${from}T00:00:00.000Z`).getTime() : null;
    // End of day inclusive. Use UTC to avoid user locale shifting.
    const toTs = to ? new Date(`${to}T23:59:59.999Z`).getTime() : null;

    return allItems.filter((it) => {
      if (networkFilter && normalizeText(it.network) !== networkFilter) return false;
      if (typeFilter && normalizeText(it.contentType) !== typeFilter) return false;

      if (fromTs !== null || toTs !== null) {
        const t = it.postedAt ? new Date(it.postedAt).getTime() : null;
        // If we have a date range filter but the item has no postedAt, exclude it.
        if (t === null || Number.isNaN(t)) return false;
        if (fromTs !== null && t < fromTs) return false;
        if (toTs !== null && t > toTs) return false;
      }

      if (qFilter) {
        const hay = normalizeText(`${it.title ?? ''} ${it.permalinkUrl ?? ''}`);
        if (!hay.includes(qFilter)) return false;
      }
      return true;
    });
  }, [allItems, network, contentType, from, to, q]);

  const selectedCount = selectedIds.size;

  useEffect(() => {
    // Prune selection as the dataset changes.
    const present = new Set(allItems.map((it) => it.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (present.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allItems]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch a reasonable batch once, then filter client-side for “real-time” UX.
      const res = await fetch(`/api/library/items?limit=200`, { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError('Failed to load library.');
        return;
      }
      if (Array.isArray(data)) {
        setAllItems(data as LibraryItem[]);
      } else {
        setAllItems([]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to load library.');
    } finally {
      setLoading(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncStatus('Syncing…');
    setError(null);
    try {
      const res = await fetch('/api/library/sync', { method: 'POST', credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setSyncStatus('Sync failed.');
        return;
      }
      const obj = asRecord(data);
      const providers = obj ? asRecord(obj.providers) : null;
      const instagram = providers ? asRecord(providers.instagram) : null;
      if (instagram) {
        const fetched = asNumber(instagram.fetched) ?? 0;
        const upserted = asNumber(instagram.upserted) ?? 0;
        setSyncStatus(`Synced. Instagram fetched=${fetched} upserted=${upserted}`);
      } else {
        setSyncStatus('Synced.');
      }
      await loadAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncStatus(`Sync failed: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  const syncSelected = async () => {
    if (selectedIds.size === 0) return;
    const selectedItems = allItems.filter((it) => selectedIds.has(it.id));
    const providers = Array.from(
      new Set(selectedItems.map((it) => (it.network || '').trim().toLowerCase()).filter(Boolean)),
    );
    const qs = providers.length > 0 ? `?providers=${encodeURIComponent(providers.join(','))}` : '';

    setSyncing(true);
    setSyncStatus(`Refreshing ${selectedItems.length} item(s)…`);
    setError(null);
    try {
      const res = await fetch(`/api/library/sync${qs}`, { method: 'POST', credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setSyncStatus('Refresh failed.');
        return;
      }
      const obj = asRecord(data);
      const providersObj = obj ? asRecord(obj.providers) : null;
      if (providersObj) {
        const parts = Object.entries(providersObj).map(([k, v]) => {
          const rr = asRecord(v);
          const upserted = rr ? asNumber(rr.upserted) ?? 0 : 0;
          return `${k}: +${upserted}`;
        });
        setSyncStatus(`Refreshed. ${parts.join(' · ')}`);
      } else {
        setSyncStatus('Refreshed.');
      }
      await loadAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncStatus(`Refresh failed: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  const selectAllFiltered = () => {
    if (filteredItems.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of filteredItems) next.add(it.id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const ok = window.confirm(`Delete ${ids.length} selected library item(s)? This cannot be undone.`);
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/library/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError('Failed to delete selected items.');
        return;
      }
      const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const deleted = typeof obj?.deleted === 'number' ? obj!.deleted : null;
      setSyncStatus(deleted !== null ? `Deleted ${deleted} item(s).` : 'Deleted.');
      setAllItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
      clearSelection();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to delete selected items.');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    void loadAll();
    try {
      const stored = window.localStorage.getItem('libraryViewMode');
      if (stored === 'list' || stored === 'gallery') setViewMode(stored);
    } catch { /* ignore */ }
  }, []);

  return (
    <Layout>
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Library</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            A local archive of content you’ve created on your connected social networks.
          </p>
        </header>

        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Network</label>
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
              >
                <option value="">All</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
                <option value="pinterest">Pinterest</option>
                <option value="threads">Threads</option>
                <option value="x">X</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Type</label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
              >
                <option value="">All</option>
                <option value="post">Post</option>
                <option value="reel">Reel</option>
                <option value="story">Story</option>
                <option value="video">Video</option>
                <option value="music">Music</option>
                <option value="pin">Pin</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">From</label>
              <div className="relative">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setFrom('');
                  }}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 pr-10 text-sm"
                />
                {!!from && (
                  <button
                    type="button"
                    aria-label="Clear from date"
                    onClick={() => setFrom('')}
                    className="absolute right-9 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">To</label>
              <div className="relative">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setTo('');
                  }}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 pr-10 text-sm"
                />
                {!!to && (
                  <button
                    type="button"
                    aria-label="Clear to date"
                    onClick={() => setTo('')}
                    className="absolute right-9 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Search</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Title…"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <button onClick={syncNow} className="btn btn-secondary" type="button" disabled={syncing}>
                {syncing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={syncSelected}
                className="btn btn-secondary"
                type="button"
                disabled={syncing || selectedCount === 0}
                title={selectedCount === 0 ? 'Select items in the gallery to refresh a subset' : 'Refresh selected items'}
              >
                {syncing ? 'Refreshing…' : `Refresh selected${selectedCount ? ` (${selectedCount})` : ''}`}
              </button>
              <button
                onClick={deleteSelected}
                className="btn bg-red-600 text-white hover:bg-red-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                type="button"
                disabled={deleting || syncing || selectedCount === 0}
                title={selectedCount === 0 ? 'Select items in the gallery to delete' : 'Delete selected items'}
              >
                {deleting ? 'Deleting…' : `Delete selected${selectedCount ? ` (${selectedCount})` : ''}`}
              </button>
              <button
                onClick={() => {
                  setNetwork('');
                  setContentType('');
                  setFrom('');
                  setTo('');
                  setQ('');
                }}
                className="btn btn-secondary"
                type="button"
              >
                Reset
              </button>
              <button
                onClick={selectAllFiltered}
                className="btn btn-secondary"
                type="button"
                disabled={filteredItems.length === 0}
                title={filteredItems.length === 0 ? 'No items to select' : 'Select all filtered items'}
              >
                Select all
              </button>
              <button
                onClick={clearSelection}
                className="btn btn-ghost"
                type="button"
                disabled={selectedCount === 0}
              >
                Clear selection
              </button>
              {loading && <span className="text-sm text-slate-600 dark:text-slate-300">Loading…</span>}
              {syncStatus && !loading && <span className="text-sm text-slate-600 dark:text-slate-300">{syncStatus}</span>}
              {error && <span className="text-sm text-red-600 dark:text-red-300">{error}</span>}
              {selectedCount > 0 && !error && (
                <span className="text-sm text-slate-600 dark:text-slate-300">{selectedCount} selected</span>
              )}
            </div>

            <div className="sm:ml-auto">
              <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('list');
                    try { window.localStorage.setItem('libraryViewMode', 'list'); } catch { /* ignore */ }
                  }}
                  className={[
                    'px-3 py-2 text-sm',
                    viewMode === 'list'
                      ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'bg-white/70 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40',
                  ].join(' ')}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('gallery');
                    try { window.localStorage.setItem('libraryViewMode', 'gallery'); } catch { /* ignore */ }
                  }}
                  className={[
                    'px-3 py-2 text-sm border-l border-slate-200 dark:border-slate-700',
                    viewMode === 'gallery'
                      ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'bg-white/70 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40',
                  ].join(' ')}
                >
                  Gallery
                </button>
              </div>
            </div>
          </div>
        </div>

        {viewMode === 'list' ? (
          <div className="card p-0 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 dark:text-slate-300 border-b border-slate-200/60 dark:border-slate-700/40">
                  <th className="py-3 px-4 font-medium">Posted</th>
                  <th className="py-3 px-4 font-medium">Network</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium">Title</th>
                  <th className="py-3 px-4 font-medium">Views</th>
                  <th className="py-3 px-4 font-medium">Likes</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-slate-500 dark:text-slate-400">
                      No library items yet. (Ingestion from networks will populate this table.)
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((it) => {
                    const posted = it.postedAt ? new Date(it.postedAt).toLocaleString() : '';
                    return (
                      <tr key={it.id} className="border-b border-slate-200/40 dark:border-slate-700/30">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-200">{posted}</td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{it.network}</td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-200">{it.contentType}</td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-200 max-w-[28rem] truncate" title={it.title || ''}>
                          {it.permalinkUrl ? (
                            <a className="underline hover:no-underline" href={it.permalinkUrl} target="_blank" rel="noreferrer">
                              {it.title || it.permalinkUrl}
                            </a>
                          ) : (
                            it.title || ''
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-200 whitespace-nowrap">{typeof it.views === 'number' ? it.views : '—'}</td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-200 whitespace-nowrap">{typeof it.likes === 'number' ? it.likes : '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 [@media(min-width:2560px)]:grid-cols-10 [@media(min-width:3200px)]:grid-cols-12 gap-4">
            {filteredItems.length === 0 ? (
              <div className="card p-8 text-slate-500 dark:text-slate-400">
                No library items yet. (Ingestion from networks will populate this gallery.)
              </div>
            ) : (
              filteredItems.map((it) => {
                const thumb = (it.thumbnailUrl || it.mediaUrl || '').trim();
                const posted = it.postedAt ? new Date(it.postedAt).toLocaleDateString() : '';
                const isSelected = selectedIds.has(it.id);
                const isLink = !!it.permalinkUrl;
                const openLink = () => {
                  if (!it.permalinkUrl) return;
                  window.open(it.permalinkUrl, '_blank', 'noopener,noreferrer');
                };

                return (
                  <div
                    key={it.id}
                    className={[
                      'card p-0 overflow-hidden hover:shadow-lg transition-shadow',
                      isSelected ? 'ring-2 ring-primary-500' : '',
                      isLink ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500' : '',
                    ].join(' ')}
                    role={isLink ? 'link' : undefined}
                    tabIndex={isLink ? 0 : undefined}
                    onClick={() => {
                      if (isLink) openLink();
                    }}
                    onKeyDown={(e) => {
                      if (!isLink) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openLink();
                      }
                    }}
                  >
                    <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                        {thumb ? (
                          <img src={thumb} alt={it.title || 'thumbnail'} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <span className="text-sm">No thumbnail</span>
                          </div>
                        )}
                        <label
                          className="absolute top-2 left-2 z-10 inline-flex items-center gap-2 rounded-md bg-white/85 dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 text-xs px-2 py-1 border border-slate-200/70 dark:border-slate-700/60"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(it.id);
                                else next.delete(it.id);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                            aria-label={`Select ${it.title || it.permalinkUrl || it.id}`}
                          />
                        </label>
                        <div className="absolute top-2 right-2 rounded-md bg-black/60 text-white text-xs px-2 py-1">
                          {it.network} · {it.contentType}
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="text-slate-900 dark:text-slate-50 font-medium truncate" title={it.title || ''}>
                          {it.title || it.permalinkUrl || 'Untitled'}
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                          <span>{posted}</span>
                          <span className="flex items-center gap-3">
                            <span>Likes: {typeof it.likes === 'number' ? it.likes : '—'}</span>
                            <span>Views: {typeof it.views === 'number' ? it.views : '—'}</span>
                          </span>
                        </div>
                      </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};
