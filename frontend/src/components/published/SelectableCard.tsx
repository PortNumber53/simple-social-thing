import React from 'react';

export function SelectableCard({
  selected,
  isLink,
  onOpen,
  checkboxLabel,
  checked,
  onCheckedChange,
  topRight,
  children,
}: {
  selected: boolean;
  isLink: boolean;
  onOpen: () => void;
  checkboxLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        'card p-0 overflow-hidden hover:shadow-lg transition-shadow',
        selected ? 'ring-2 ring-primary-500' : '',
        isLink ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500' : '',
      ].join(' ')}
      role={isLink ? 'link' : undefined}
      tabIndex={isLink ? 0 : undefined}
      onClick={() => {
        if (isLink) onOpen();
      }}
      onKeyDown={(e) => {
        if (!isLink) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="relative">
        <label
          className="absolute top-2 left-2 z-10 inline-flex items-center gap-2 rounded-md bg-white/85 dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 text-xs px-2 py-1 border border-slate-200/70 dark:border-slate-700/60"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
            aria-label={checkboxLabel}
          />
        </label>
        {topRight ? (
          <div className="absolute top-2 right-2 z-10">
            {topRight}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
