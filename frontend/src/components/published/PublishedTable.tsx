import type { PublishedItem } from './types';

export function PublishedTable({ items }: { items: PublishedItem[] }) {
  return (
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
                No published items yet. Run “Refresh” to sync.
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
  );
}
