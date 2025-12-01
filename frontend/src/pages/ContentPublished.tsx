import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [deleteExternal, setDeleteExternal] = useState<boolean>(false);
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());
  const deleteAckTimerRef = useRef<number | null>(null);

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
    if (selectedIds.size === 0) {
      setError('Select one or more items to delete.');
      console.info('[PublishedDelete] skipped (no selection)');
      return;
    }
    const ids = Array.from(selectedIds);
    const ok = window.confirm(
      deleteExternal
        ? `Remove ${ids.length} selected item(s) from this app AND attempt to delete them from the social network (where supported).\n\nThis is irreversible.\n\nNote: only Instagram is supported right now; other networks will be skipped and kept in the library.`
        : `Remove ${ids.length} selected item(s) from this app?\n\nNote: this removes the cached items from the Published gallery in this app. It does NOT delete the post on Instagram/Facebook/etc.`,
    );
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      console.info('[PublishedDelete] start', { count: ids.length });
      const res = await apiJson<unknown>('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, deleteExternal }),
      });
      const data: unknown = res.ok ? res.data : null;
      if (!res.ok) {
        console.error('[PublishedDelete] failed', { status: res.status, message: res.error.message, data: res.data });
        setError(res.error.message || 'Failed to delete selected items.');
        return;
      }
      const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const deleted = typeof obj?.deleted === 'number' ? obj!.deleted : null;
      const deletedIdsRaw = obj?.ids;
      const deletedIds = Array.isArray(deletedIdsRaw)
        ? deletedIdsRaw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
        : [];

      // In tests, don't wait for realtime — confirm immediately via the API response.
      if (import.meta.env.MODE === 'test') {
        const deletedSet = new Set(deletedIds.length > 0 ? deletedIds : ids);
        setAllItems((prev) => prev.filter((it) => !deletedSet.has(it.id)));
        clearSelection();
        if (deleted !== null) {
          const msg =
            deletedIds.length > 0 && deleted !== ids.length ? `Removed ${deleted} of ${ids.length} item(s) from library.` : `Removed ${deleted} item(s) from library.`;
          setSyncStatus(msg);
        } else {
          setSyncStatus('Removed from library.');
        }
        console.info('[PublishedDelete] ok (api-confirmed)', { deleted, ids: deletedSet.size });
        return;
      }

      // Production UX: only remove from UI after realtime confirmation (so we never lie to the user).
      pendingDeleteIdsRef.current = new Set(deletedIds.length > 0 ? deletedIds : ids);
      setSyncStatus(deleteExternal ? 'Delete requested. Waiting for confirmation…' : 'Remove requested. Waiting for confirmation…');

      const external = obj?.external && typeof obj.external === 'object' ? (obj.external as any) : null;
      const failed = external && Array.isArray(external.failed) ? external.failed : [];
      if (deleteExternal && failed.length > 0) {
        setError(`Some items were not deleted from the social network (unsupported or failed). They will remain in the library.`);
      }

      if (deleteAckTimerRef.current) window.clearTimeout(deleteAckTimerRef.current);
      deleteAckTimerRef.current = window.setTimeout(() => {
        if (pendingDeleteIdsRef.current.size === 0) return;
        console.warn('[PublishedDelete] no realtime confirmation; falling back to refresh', { pending: pendingDeleteIdsRef.current.size });
        pendingDeleteIdsRef.current = new Set();
        void loadAll();
        clearSelection();
        if (deleted !== null) {
          setSyncStatus(deleted !== ids.length ? `Removed ${deleted} of ${ids.length} item(s) from library.` : `Removed ${deleted} item(s) from library.`);
        } else {
          setSyncStatus('Removed from library.');
        }
      }, 4000);

      console.info('[PublishedDelete] ok (awaiting realtime)', { deleted, ids: pendingDeleteIdsRef.current.size });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[PublishedDelete] exception', { message: msg });
      setError(msg || 'Failed to delete selected items.');
    } finally {
      setDeleting(false);
    }
  };

  // Realtime updates (StatusBar keeps a WS open and broadcasts messages via window events).
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    if (typeof window === 'undefined') return;

    const onRealtime = (ev: Event) => {
      const ce = ev as CustomEvent;
      const msg = ce?.detail as any;
      if (!msg || typeof msg !== 'object') return;
      if (String(msg.type || '') !== 'library.deleted') return;
      const idsRaw = msg.ids;
      const ids = Array.isArray(idsRaw) ? idsRaw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];
      if (ids.length === 0) return;

      const removed = new Set(ids);
      setAllItems((prev) => prev.filter((it) => !removed.has(it.id)));
      ids.forEach((id) => setSelected(id, false));

      const pending = pendingDeleteIdsRef.current;
      const overlaps = pending.size === 0 ? false : ids.some((id) => pending.has(id));
      if (overlaps) {
        pendingDeleteIdsRef.current = new Set();
        if (deleteAckTimerRef.current) {
          window.clearTimeout(deleteAckTimerRef.current);
          deleteAckTimerRef.current = null;
        }
        setSyncStatus(`Removed ${ids.length} item(s) from library.`);
        console.info('[PublishedRealtime] confirm library.deleted', { ids: ids.length });
      }
    };

    window.addEventListener('realtime:event', onRealtime as EventListener);
    return () => window.removeEventListener('realtime:event', onRealtime as EventListener);
  }, [setSelected]);

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
          deleteExternal={deleteExternal}
          setDeleteExternal={setDeleteExternal}
        />

        {viewMode === 'list' ? (
          <PublishedTable items={filteredItems} selectedIds={selectedIds} onSelect={setSelected} />
        ) : (
          <PublishedGallery items={filteredItems} selectedIds={selectedIds} onSelect={setSelected} />
        )}
      </div>
    </Layout>
  );
};
