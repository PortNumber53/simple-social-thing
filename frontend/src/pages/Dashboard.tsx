import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useIntegrations, type ProviderKey } from '../contexts/IntegrationsContext';
import { apiJson } from '../lib/api';
import { Skeleton } from '../components/Skeleton';

type LibraryStats = { drafts: number; scheduled: number };

const PROVIDERS: ProviderKey[] = ['instagram', 'tiktok', 'facebook', 'youtube', 'pinterest', 'threads'];
const PUBLISH_SUPPORTED: Record<ProviderKey, boolean> = {
  instagram: true,
  facebook: true,
  tiktok: true,
  youtube: true,
  pinterest: true,
  threads: false,
};

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  threads: 'Threads',
};

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { connectedProviders } = useIntegrations();
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);

  const publishReadyProviders = useMemo(
    () => connectedProviders.filter((p) => PUBLISH_SUPPORTED[p]),
    [connectedProviders],
  );

  useEffect(() => {
    if (!user) { setLibraryStats(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const [drafts, scheduled] = await Promise.all([
          apiJson<unknown[]>(`/api/local-library/items?status=draft`),
          apiJson<unknown[]>(`/api/local-library/items?status=scheduled`),
        ]);
        if (cancelled) return;
        setLibraryStats({
          drafts: drafts.ok && Array.isArray(drafts.data) ? drafts.data.length : 0,
          scheduled: scheduled.ok && Array.isArray(scheduled.data) ? scheduled.data.length : 0,
        });
      } catch {
        if (!cancelled) setLibraryStats({ drafts: 0, scheduled: 0 });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100">
          Welcome back, {user?.name?.split(' ')[0] || 'there'}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Here's an overview of your social media activity.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <a href="/content/posts" className="btn btn-primary text-sm">
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Compose Post
        </a>
        <a href="/library" className="btn btn-secondary text-sm">Upload Media</a>
        <a href="/integrations" className="btn btn-secondary text-sm">Connect Account</a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Drafts</p>
          {libraryStats ? (
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{libraryStats.drafts}</p>
          ) : (
            <Skeleton className="h-9 w-16 mt-1" />
          )}
          <a className="text-sm text-primary-600 dark:text-primary-400 font-medium hover:underline mt-2 inline-block" href="/library">
            Go to drafts &rarr;
          </a>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Scheduled</p>
          {libraryStats ? (
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{libraryStats.scheduled}</p>
          ) : (
            <Skeleton className="h-9 w-16 mt-1" />
          )}
          <a className="text-sm text-primary-600 dark:text-primary-400 font-medium hover:underline mt-2 inline-block" href="/library">
            Review schedule &rarr;
          </a>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Connected networks</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            {publishReadyProviders.length} / {PROVIDERS.filter((p) => PUBLISH_SUPPORTED[p]).length}
          </p>
          <a className="text-sm text-primary-600 dark:text-primary-400 font-medium hover:underline mt-2 inline-block" href="/integrations">
            Manage providers &rarr;
          </a>
        </div>
      </div>

      {/* Connected accounts */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">Connected accounts</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {PROVIDERS.map((provider) => {
            const connected = connectedProviders.includes(provider);
            return (
              <div key={provider} className={`card text-center py-4 px-3 ${connected ? '' : 'opacity-60'}`}>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{PROVIDER_LABELS[provider]}</p>
                {connected ? (
                  <span className="badge badge-success text-[10px] mt-2">Connected</span>
                ) : (
                  <a href="/integrations" className="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-2 inline-block">Connect</a>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Getting started tips */}
      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">Getting started</h2>
        <ul className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 text-xs font-bold shrink-0">1</span>
            <span><a href="/integrations" className="text-primary-600 dark:text-primary-400 font-medium hover:underline">Connect your social accounts</a> to enable publishing.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 text-xs font-bold shrink-0">2</span>
            <span><a href="/content/posts" className="text-primary-600 dark:text-primary-400 font-medium hover:underline">Compose a post</a> with images or video and publish to multiple networks at once.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 text-xs font-bold shrink-0">3</span>
            <span><a href="/library" className="text-primary-600 dark:text-primary-400 font-medium hover:underline">Use the library</a> to draft, schedule, and manage your content calendar.</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
