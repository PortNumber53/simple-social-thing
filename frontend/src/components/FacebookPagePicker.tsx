export type FacebookPagePickerPage = {
  id: string;
  name: string | null;
  canPost: boolean;
};

export function FacebookPagePicker({
  visible,
  expanded,
  setExpanded,
  pages,
  selectedById,
  onTogglePage,
}: {
  visible: boolean;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  pages: FacebookPagePickerPage[];
  selectedById: Record<string, boolean>;
  onTogglePage: (pageId: string, checked: boolean) => void;
}) {
  if (!visible) return null;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white/60 dark:bg-slate-900/20">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Facebook Pages</div>
        <button
          type="button"
          className="text-xs underline text-slate-600 dark:text-slate-300"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide pages' : 'Choose pages'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          {pages.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-300">
              No pages found (or you need to reconnect Facebook so we can read your page list/tasks).
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {pages.map((pg) => {
                const disabled = !pg.canPost;
                return (
                  <label
                    key={pg.id}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      disabled ? 'border-slate-200 dark:border-slate-700 opacity-60' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={!!selectedById[pg.id]}
                      onChange={(e) => onTogglePage(pg.id, e.target.checked)}
                    />
                    <div className="min-w-0">
                      <div className="text-slate-800 dark:text-slate-100 truncate">
                        {pg.name || pg.id}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {disabled ? 'Not postable with your current role' : 'Will post to this page'}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Tip: if everything is disabled, reconnect Facebook and ensure your user has Page permissions that include creating content.
          </div>
        </div>
      )}
    </div>
  );
}
