import type React from 'react';

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm';
  return (
    <div className={['inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden', className || ''].join(' ').trim()}>
      {options.map((opt, idx) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={!!opt.disabled}
            onClick={() => onChange(opt.value)}
            className={[
              pad,
              idx > 0 ? 'border-l border-slate-200 dark:border-slate-700' : '',
              active
                ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'bg-white/70 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40',
              opt.disabled ? 'opacity-50 pointer-events-none' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
