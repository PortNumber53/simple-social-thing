import { SelectableCard } from './SelectableCard';
import type { PublishedItem } from './types';

export function PublishedGallery({
  items,
  selectedIds,
  onSelect,
}: {
  items: PublishedItem[];
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 [@media(min-width:2560px)]:grid-cols-10 [@media(min-width:3200px)]:grid-cols-12 gap-4">
      {items.length === 0 ? (
        <div className="card p-8 text-slate-500 dark:text-slate-400">
          No published items yet. Run “Refresh” to sync.
        </div>
      ) : (
        items.map((it) => {
          const thumb = (it.thumbnailUrl || it.mediaUrl || '').trim();
          const posted = it.postedAt ? new Date(it.postedAt).toLocaleDateString() : '';
          const isSelected = selectedIds.has(it.id);
          const isLink = !!it.permalinkUrl;
          const openLink = () => {
            if (!it.permalinkUrl) return;
            window.open(it.permalinkUrl, '_blank', 'noopener,noreferrer');
          };

          return (
            <SelectableCard
              key={it.id}
              selected={isSelected}
              isLink={isLink}
              onOpen={openLink}
              checked={isSelected}
              onCheckedChange={(checked) => onSelect(it.id, checked)}
              checkboxLabel={`Select ${it.title || it.permalinkUrl || it.id}`}
              topRight={
                <div className="rounded-md bg-black/60 text-white text-xs px-2 py-1">
                  {it.network} · {it.contentType}
                </div>
              }
            >
              <div className="aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                {thumb ? (
                  <img src={thumb} alt={it.title || 'thumbnail'} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <span className="text-sm">No thumbnail</span>
                  </div>
                )}
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
            </SelectableCard>
          );
        })
      )}
    </div>
  );
}
