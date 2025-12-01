import { LabeledField } from '../LabeledField';
import { IconButton } from '../IconButton';
import { SegmentedControl } from '../SegmentedControl';

export function PublishedFiltersToolbar({
  network,
  setNetwork,
  contentType,
  setContentType,
  from,
  setFrom,
  to,
  setTo,
  q,
  setQ,
  syncing,
  syncingText,
  loading,
  error,
  selectedCount,
  filteredCount,
  viewMode,
  setViewMode,
  onSyncNow,
  onSyncSelected,
  onDeleteSelected,
  onReset,
  onSelectAllFiltered,
  onClearSelection,
  deleting,
  deleteExternal,
  setDeleteExternal,
}: {
  network: string;
  setNetwork: (v: string) => void;
  contentType: string;
  setContentType: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  q: string;
  setQ: (v: string) => void;

  syncing: boolean;
  syncingText: string | null;
  loading: boolean;
  error: string | null;
  selectedCount: number;
  filteredCount: number;
  deleting: boolean;
  deleteExternal: boolean;
  setDeleteExternal: (v: boolean) => void;

  viewMode: 'list' | 'gallery';
  setViewMode: (v: 'list' | 'gallery') => void;

  onSyncNow: () => void;
  onSyncSelected: () => void;
  onDeleteSelected: () => void;
  onReset: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <LabeledField label="Network">
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
        </LabeledField>

        <LabeledField label="Type">
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
        </LabeledField>

        <LabeledField label="From">
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
              <IconButton label="Clear from date" onClick={() => setFrom('')} className="absolute right-9 top-1/2 -translate-y-1/2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </IconButton>
            )}
          </div>
        </LabeledField>

        <LabeledField label="To">
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
              <IconButton label="Clear to date" onClick={() => setTo('')} className="absolute right-9 top-1/2 -translate-y-1/2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </IconButton>
            )}
          </div>
        </LabeledField>

        <LabeledField label="Search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title…"
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
          />
        </LabeledField>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <button onClick={onSyncNow} className="btn btn-secondary" type="button" disabled={syncing}>
            {syncing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={onSyncSelected}
            className="btn btn-secondary"
            type="button"
            disabled={syncing || selectedCount === 0}
            title={selectedCount === 0 ? 'Select items in the gallery to refresh a subset' : 'Refresh selected items'}
          >
            {syncing ? 'Refreshing…' : `Refresh selected${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
          <button
            onClick={onDeleteSelected}
            className="btn bg-red-600 text-white hover:bg-red-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            type="button"
            disabled={deleting || syncing || selectedCount === 0}
            title={selectedCount === 0 ? 'Select items to remove from the library' : 'Remove selected items from the library (does not delete from the social network)'}
          >
            {deleting ? 'Removing…' : `Remove from library${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
          <button onClick={onReset} className="btn btn-secondary" type="button">
            Reset
          </button>
          <button
            onClick={onSelectAllFiltered}
            className="btn btn-secondary"
            type="button"
            disabled={filteredCount === 0}
            title={filteredCount === 0 ? 'No items to select' : 'Select all filtered items'}
          >
            Select all
          </button>
          <button onClick={onClearSelection} className="btn btn-ghost" type="button" disabled={selectedCount === 0}>
            Clear selection
          </button>
          {loading && <span className="text-sm text-slate-600 dark:text-slate-300">Loading…</span>}
          {syncingText && !loading && <span className="text-sm text-slate-600 dark:text-slate-300">{syncingText}</span>}
          {error && <span className="text-sm text-red-600 dark:text-red-300">{error}</span>}
          {selectedCount > 0 && !error && (
            <span className="text-sm text-slate-600 dark:text-slate-300">{selectedCount} selected</span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={deleteExternal} onChange={(e) => setDeleteExternal(e.target.checked)} disabled />
          Also delete from the social network
          <span className="text-xs text-slate-500 dark:text-slate-400">(not supported)</span>
        </label>

        <div className="sm:ml-auto">
          <SegmentedControl
            value={viewMode}
            options={[
              { value: 'list', label: 'List' },
              { value: 'gallery', label: 'Gallery' },
            ]}
            onChange={setViewMode}
          />
        </div>
      </div>
    </div>
  );
}
