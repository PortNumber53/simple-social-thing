import type React from 'react';

export type UploadPreview = {
  id: string;
  file?: File;
  url: string;
  filename: string;
  uploading?: boolean;
  progress?: number;
  error?: string | null;
  kind: 'image' | 'video' | 'other';
};

export function UploadGrid({
  uploads,
  selectedUploadIds,
  setSelectedUploadIds,
  dragUploadId,
  setDragUploadId,
  dragOverUploadId,
  setDragOverUploadId,
  lastUploadError,
  uploadInputRef,
  addFiles,
  clearUploads,
  removeUpload,
  reorderUploads,
  parseUploadIdsFromDataTransfer,
  fallbackToLocalPreviewIfPossible,
}: {
  uploads: UploadPreview[];
  selectedUploadIds: Set<string>;
  setSelectedUploadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  dragUploadId: string | null;
  setDragUploadId: React.Dispatch<React.SetStateAction<string | null>>;
  dragOverUploadId: string | null;
  setDragOverUploadId: React.Dispatch<React.SetStateAction<string | null>>;
  lastUploadError: string | null;
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  addFiles: (files: FileList | File[] | null | undefined) => void;
  clearUploads: () => void;
  removeUpload: (id: string) => void;
  reorderUploads: (fromId: string, toId: string) => void;
  parseUploadIdsFromDataTransfer: (dt: DataTransfer) => string[];
  fallbackToLocalPreviewIfPossible: (u: UploadPreview) => void;
}) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Uploads</div>
        <div className="flex items-center gap-2">
          {uploads.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={clearUploads}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => uploadInputRef.current?.click()}>
            Add files
          </button>
        </div>
      </div>

      {lastUploadError && (
        <div className="rounded-lg border border-red-200/70 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          Last upload error: <span className="font-mono">{lastUploadError}</span>
        </div>
      )}

      <div
        className="rounded-lg border border-dashed border-slate-300/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/20 p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes('application/x-sst-upload-ids')) return;
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            Drag & drop files here, or click <span className="font-medium">Add files</span>.
          </div>
          <div className="sm:ml-auto text-xs text-slate-500 dark:text-slate-400">
            Images & videos · multiple files
          </div>
        </div>
      </div>

      {uploads.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-6 gap-3">
          {uploads.map((u) => (
            <div
              key={u.id}
              className={[
                'card p-0 overflow-hidden',
                dragOverUploadId === u.id && dragUploadId && dragUploadId !== u.id ? 'ring-2 ring-primary-500' : '',
                dragUploadId === u.id ? 'opacity-60' : '',
                selectedUploadIds.has(u.id) ? 'ring-2 ring-primary-500' : '',
              ].join(' ')}
              draggable={!u.uploading && !u.error}
              onDragStart={(e) => {
                if (u.uploading || u.error) return;
                const ids = selectedUploadIds.size > 0 && selectedUploadIds.has(u.id) ? Array.from(selectedUploadIds) : [u.id];
                setDragUploadId(u.id);
                setDragOverUploadId(null);
                e.dataTransfer.effectAllowed = ids.length > 1 ? 'copy' : 'move';
                try {
                  e.dataTransfer.setData('application/x-sst-upload-ids', JSON.stringify(ids));
                  e.dataTransfer.setData('text/plain', ids.join(','));
                } catch {
                  /* ignore */
                }
              }}
              onDragEnd={() => {
                setDragUploadId(null);
                setDragOverUploadId(null);
              }}
              onDragOver={(e) => {
                if (!dragUploadId || dragUploadId === u.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverUploadId(u.id);
              }}
              onDragLeave={() => setDragOverUploadId((prev) => (prev === u.id ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                const ids = parseUploadIdsFromDataTransfer(e.dataTransfer);
                if (ids.length !== 1) return; // only reorder single-item drags
                reorderUploads(ids[0], u.id);
                setDragOverUploadId(null);
              }}
              title="Drag to reorder"
            >
              <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                {u.kind === 'image' ? (
                  <img
                    src={u.url}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => fallbackToLocalPreviewIfPossible(u)}
                    draggable={false}
                  />
                ) : u.kind === 'video' ? (
                  <video
                    src={u.url}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    onError={() => fallbackToLocalPreviewIfPossible(u)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <span className="text-sm">File</span>
                  </div>
                )}
                <label
                  className="absolute top-2 left-2 z-10 inline-flex items-center justify-center rounded-md bg-white/85 dark:bg-slate-900/70 text-slate-900 dark:text-slate-100 border border-slate-200/70 dark:border-slate-700/60 p-1 shadow-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedUploadIds.has(u.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedUploadIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(u.id);
                        else next.delete(u.id);
                        return next;
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                    aria-label={`Select ${u.filename}`}
                  />
                </label>

                <button
                  type="button"
                  className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs hover:bg-slate-900/80"
                  aria-label={`Remove ${u.filename}`}
                  onClick={() => removeUpload(u.id)}
                >
                  ×
                </button>

                {u.uploading && (
                  <div className="absolute inset-x-2 bottom-2">
                    <div className="h-2 rounded-full bg-black/30 overflow-hidden">
                      <div
                        className="h-full bg-primary-500"
                        style={{ width: `${Math.max(0, Math.min(100, u.progress ?? 0))}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-white/90 drop-shadow">
                      Uploading… {Math.max(0, Math.min(100, u.progress ?? 0))}%
                    </div>
                  </div>
                )}
                {!u.uploading && u.error && (
                  <div className="absolute inset-x-2 bottom-2 rounded-md bg-red-600/85 text-white text-[11px] px-2 py-1">
                    Upload failed: <span className="font-mono">{(u.error || '').slice(0, 120)}</span>
                  </div>
                )}

                <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/60 text-white text-[11px] px-2 py-1 truncate">
                  {u.filename}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
