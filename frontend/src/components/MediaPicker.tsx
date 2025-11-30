import type React from 'react';

export type MediaPickerItem = {
  id: string;
  url: string;
  alt?: string;
};

export function MediaPicker({
  label,
  accept,
  multiple = true,
  onFiles,
  items,
  onRemove,
  helperText,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: FileList | null) => void;
  items: MediaPickerItem[];
  onRemove: (id: string) => void;
  helperText?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      <input type="file" accept={accept} multiple={multiple} onChange={(e) => onFiles(e.target.files)} />
      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {items.map((m) => (
            <div key={m.id} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <img src={m.url} alt={m.alt || 'preview'} className="w-full h-32 object-cover" />
              <button
                onClick={() => onRemove(m.id)}
                type="button"
                className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove media"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {helperText ? <p className="text-xs text-slate-500 dark:text-slate-400">{helperText}</p> : null}
    </div>
  );
}
