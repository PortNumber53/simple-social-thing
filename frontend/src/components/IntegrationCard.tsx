import type React from 'react';

export function IntegrationCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
      <div className="flex-none">{icon}</div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">{description}</p>
        <div className="mt-4 space-y-2">{children}</div>
      </div>
    </div>
  );
}
