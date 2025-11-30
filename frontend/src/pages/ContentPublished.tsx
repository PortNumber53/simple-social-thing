import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { apiJson } from '../lib/api';
import { useLocalStorageState } from '../lib/useLocalStorageState';
import { useSelectionSet } from '../lib/useSelectionSet';
import { PublishedFiltersToolbar } from '../components/published/PublishedFiltersToolbar';
import { PublishedGallery } from '../components/published/PublishedGallery';
import { PublishedTable } from '../components/published/PublishedTable';
import type { PublishedItem } from '../components/published/types';

export const ContentPublished: React.FC = () => {
  const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const [network, setNetwork] = useState<string>('');
  const [contentType, setContentType] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState<string>('');

  const [allItems, setAllItems] = useState<PublishedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useLocalStorageState<'list' | 'gallery'>('publishedViewMode', 'list');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const {
    selectedIds,
    selectedCount,
    setSelected,
    addMany: selectMany,
    clear: clearSelection,
  } = useSelectionSet<string>(allItems.map((it) => it.id));
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

  // (selection pruning handled by useSelectionSet)

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch a reasonable batch once, then filter client-side for “real-time” UX.
      const res = await apiJson<unknown>(`/api/library/items?limit=200`);
      const data = res.ok ? res.data : null;
      if (!res.ok) {
        setError('Failed to load published content.');
        return;
      }
      if (Array.isArray(data)) {
        setAllItems(data as PublishedItem[]);
      } else {
        setAllItems([]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to load published content.');
    } finally {
      setLoading(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncStatus('Syncing…');
    setError(null);
    try {
      const res = await apiJson<unknown>('/api/library/sync', { method: 'POST' });
      const data: unknown = res.ok ? res.data : null;
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
      const res = await apiJson<unknown>(`/api/library/sync${qs}`, { method: 'POST' });
      const data: unknown = res.ok ? res.data : null;
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
    selectMany(filteredItems.map((it) => it.id));
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const ok = window.confirm(`Delete ${ids.length} selected published item(s)? This cannot be undone.`);
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await apiJson<unknown>('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data: unknown = res.ok ? res.data : null;
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
  }, []);

  return (
    <Layout>
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Published</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            An archive of content published on your connected social networks (synced into this app).
          </p>
        </header>

        <PublishedFiltersToolbar
          network={network}
          setNetwork={setNetwork}
          contentType={contentType}
          setContentType={setContentType}
          from={from}
          setFrom={setFrom}
          to={to}
          setTo={setTo}
          q={q}
          setQ={setQ}
          syncing={syncing}
          syncingText={syncStatus}
          loading={loading}
          error={error}
          selectedCount={selectedCount}
          filteredCount={filteredItems.length}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onSyncNow={syncNow}
          onSyncSelected={syncSelected}
          onDeleteSelected={deleteSelected}
          onReset={() => {
            setNetwork('');
            setContentType('');
            setFrom('');
            setTo('');
            setQ('');
          }}
          onSelectAllFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          deleting={deleting}
        />

        {viewMode === 'list' ? (
          <PublishedTable items={filteredItems} />
        ) : (
          <PublishedGallery items={filteredItems} selectedIds={selectedIds} onSelect={setSelected} />
        )}
      </div>
    </Layout>
  );
};
