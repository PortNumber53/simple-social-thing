import type React from 'react';

export function IconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-md p-1 text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
        'disabled:opacity-50 disabled:pointer-events-none',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  );
}
