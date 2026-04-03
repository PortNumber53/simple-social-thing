import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  content: 'Content',
  posts: 'Compose',
  videos: 'Videos',
  'video-editor': 'Video Editor',
  published: 'Published',
  music: 'Music',
  library: 'Library',
  integrations: 'Integrations',
  account: 'Account',
  profile: 'Profile',
  settings: 'Settings',
  billing: 'Billing',
  admin: 'Admin',
  users: 'Users',
  analytics: 'Analytics',
  'custom-plan-requests': 'Custom Plans',
};

export const Breadcrumbs: React.FC = () => {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length <= 1) return null;

  const crumbs = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');
    const label = ROUTE_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
    const isLast = i === segments.length - 1;
    return { path, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {crumbs.map((crumb, i) => (
        <React.Fragment key={crumb.path}>
          {i > 0 && (
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          {crumb.isLast ? (
            <span className="text-slate-900 dark:text-slate-100 font-medium">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
              {crumb.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};
