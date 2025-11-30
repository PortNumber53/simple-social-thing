import type React from 'react';

export function ProviderPicker({
  connectedProviders,
  selected,
  setSelected,
  selectAll,
  setSelectAll,
  publishSupported,
  providerLabels,
  facebookProviderRef,
  facebookChecked,
  onFacebookToggleAll,
  facebookCountLabel,
  onToggleAllConnected,
}: {
  connectedProviders: string[];
  selected: Record<string, boolean>;
  setSelected: (next: Record<string, boolean>) => void;
  selectAll: boolean;
  setSelectAll: (v: boolean) => void;
  publishSupported: Record<string, boolean>;
  providerLabels: Record<string, string>;
  facebookProviderRef: React.RefObject<HTMLInputElement | null>;
  facebookChecked: boolean;
  onFacebookToggleAll: (checked: boolean) => void;
  facebookCountLabel?: string;
  onToggleAllConnected: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Networks</label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={selectAll}
            onChange={(e) => {
              const v = e.target.checked;
              setSelectAll(v);
              onToggleAllConnected(v);
            }}
          />
          Post to all connected
        </label>
      </div>

      {connectedProviders.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-300">
          No connected networks yet. Go to <a href="/integrations" className="underline">Integrations</a> to connect.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
          {connectedProviders.map((p) =>
            p === 'facebook' ? (
              <label key={p} className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                <input
                  ref={facebookProviderRef}
                  type="checkbox"
                  checked={facebookChecked}
                  onChange={(e) => onFacebookToggleAll(e.target.checked)}
                />
                <span className="text-slate-800 dark:text-slate-100">{providerLabels[p] || p}</span>
                {facebookCountLabel ? (
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{facebookCountLabel}</span>
                ) : null}
              </label>
            ) : (
              <label
                key={p}
                className={`flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm ${
                  publishSupported[p] !== true ? 'opacity-60' : ''
                }`}
                title={publishSupported[p] === true ? '' : 'Publishing not supported yet'}
              >
                <input
                  type="checkbox"
                  disabled={publishSupported[p] !== true}
                  checked={!!selected[p] && publishSupported[p] === true}
                  onChange={(e) => setSelected({ ...selected, [p]: e.target.checked })}
                />
                <span className="text-slate-800 dark:text-slate-100">{providerLabels[p] || p}</span>
                {publishSupported[p] !== true && (
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">coming soon</span>
                )}
              </label>
            ),
          )}
        </div>
      )}
    </div>
  );
}
