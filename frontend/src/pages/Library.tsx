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
      const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const providers = obj && typeof obj.providers === 'object' && obj.providers ? (obj.providers as Record<string, any>) : null;
      if (providers?.instagram) {
        setSyncStatus(`Synced. Instagram fetched=${providers.instagram.fetched ?? 0} upserted=${providers.instagram.upserted ?? 0}`);
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

  useEffect(() => {
    void loadAll();
    try {
      const stored = window.localStorage.getItem('libraryViewMode');
      if (stored === 'list' || stored === 'gallery') setViewMode(stored);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
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
              {loading && <span className="text-sm text-slate-600 dark:text-slate-300">Loading…</span>}
              {syncStatus && !loading && <span className="text-sm text-slate-600 dark:text-slate-300">{syncStatus}</span>}
              {error && <span className="text-sm text-red-600 dark:text-red-300">{error}</span>}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.length === 0 ? (
              <div className="card p-8 text-slate-500 dark:text-slate-400">
                No library items yet. (Ingestion from networks will populate this gallery.)
              </div>
            ) : (
              filteredItems.map((it) => {
                const thumb = (it.thumbnailUrl || it.mediaUrl || '').trim();
                const posted = it.postedAt ? new Date(it.postedAt).toLocaleDateString() : '';
                const CardWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
                  it.permalinkUrl ? (
                    <a href={it.permalinkUrl} target="_blank" rel="noreferrer" className="block">
                      {children}
                    </a>
                  ) : (
                    <div>{children}</div>
                  );

                return (
                  <CardWrapper key={it.id}>
                    <div className="card p-0 overflow-hidden hover:shadow-lg transition-shadow">
                      <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                        {thumb ? (
                          <img src={thumb} alt={it.title || 'thumbnail'} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <span className="text-sm">No thumbnail</span>
                          </div>
                        )}
                        <div className="absolute top-2 left-2 rounded-md bg-black/60 text-white text-xs px-2 py-1">
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
                  </CardWrapper>
                );
              })
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};
