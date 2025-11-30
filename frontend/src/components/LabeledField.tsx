import React from 'react';

export function LabeledField({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={['space-y-1', className || ''].join(' ').trim()}>
      <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</div>
      {children}
    </div>
  );
}
