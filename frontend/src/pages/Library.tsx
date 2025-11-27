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

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list');

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (network) params.set('network', network);
    if (contentType) params.set('type', contentType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (q) params.set('q', q);
    params.set('limit', '100');
    return params.toString();
  }, [network, contentType, from, to, q]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/items?${queryString}`, { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError('Failed to load library.');
        return;
      }
      if (Array.isArray(data)) {
        setItems(data as LibraryItem[]);
      } else {
        setItems([]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to load library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
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
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
              />
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
              <button onClick={load} className="btn btn-primary">
                {loading ? 'Loading…' : 'Apply filters'}
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
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-slate-500 dark:text-slate-400">
                      No library items yet. (Ingestion from networks will populate this table.)
                    </td>
                  </tr>
                ) : (
                  items.map((it) => {
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
            {items.length === 0 ? (
              <div className="card p-8 text-slate-500 dark:text-slate-400">
                No library items yet. (Ingestion from networks will populate this gallery.)
              </div>
            ) : (
              items.map((it) => {
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


