import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';

type LibraryItem = {
  id: string;
  network: string;
  contentType: string;
  title?: string | null;
  permalinkUrl?: string | null;
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
        </div>

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
      </div>
    </Layout>
  );
};


