import React, { useEffect, useMemo, useState } from 'react';
import { TopNavigation } from '../components/TopNavigation';
import { StatusBar } from '../components/StatusBar';
import { useAuth } from '../contexts/AuthContext';
import { useIntegrations, type ProviderKey } from '../contexts/IntegrationsContext';
import { apiJson } from '../lib/api';

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

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { connectedProviders } = useIntegrations();
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);

  const publishReadyProviders = useMemo(
    () => connectedProviders.filter((p) => PUBLISH_SUPPORTED[p]),
    [connectedProviders],
  );

  useEffect(() => {
    // Pull a lightweight snapshot of the local library queues so we can show real numbers.
    if (!user) {
      setLibraryStats(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const [drafts, scheduled] = await Promise.all([
          apiJson<unknown[]>(`/api/local-library/items?status=draft`),
          apiJson<unknown[]>(`/api/local-library/items?status=scheduled`),
        ]);
        if (cancelled) return;
        const next: LibraryStats = {
          drafts: drafts.ok && Array.isArray(drafts.data) ? drafts.data.length : 0,
          scheduled: scheduled.ok && Array.isArray(scheduled.data) ? scheduled.data.length : 0,
        };
        setLibraryStats(next);
      } catch (e: unknown) {
        if (cancelled) return;
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-blue-950 dark:to-indigo-950">
      <TopNavigation />

      {/* Main Content - with padding for fixed nav and status bar */}
      <main className="pt-20 pb-14 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-7xl 2xl:max-w-none mx-auto">
          {/* Welcome Section */}
          <div className="mb-8 animate-fade-in">
            <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Delivery dashboard, {user?.name?.split(' ')[0] || 'team'} 👋
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-400">
              Snapshot of the shipped features and what still needs wiring based on the current codebase.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-slide-up">
            <div className="card card-hover">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Drafts</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                {libraryStats ? libraryStats.drafts : '—'}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Ready to edit or publish now.</p>
              <a className="text-sm text-primary-700 dark:text-primary-300 font-semibold hover:underline mt-3 inline-block" href="/library">
                Go to Drafts →
              </a>
            </div>

            <div className="card card-hover">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Scheduled posts</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                {libraryStats ? libraryStats.scheduled : '—'}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Queued with retry/backoff safeguards.</p>
              <a className="text-sm text-primary-700 dark:text-primary-300 font-semibold hover:underline mt-3 inline-block" href="/library">
                Review schedule →
              </a>
            </div>

            <div className="card card-hover">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Publish-ready networks</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                {publishReadyProviders.length} / {PROVIDERS.filter((p) => PUBLISH_SUPPORTED[p]).length}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Includes Instagram, Pinterest, Facebook Pages, YouTube, TikTok.
              </p>
              <a className="text-sm text-primary-700 dark:text-primary-300 font-semibold hover:underline mt-3 inline-block" href="/integrations">
                Manage providers →
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 animate-slide-up">
            <div className="card card-hover">
              <div className="mb-3">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">What to do next</h3>
              </div>
              <ul className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                <li>
                  <a className="text-primary-700 dark:text-primary-300 font-semibold hover:underline" href="/integrations">
                    Connect remaining providers to unlock publish paths
                  </a>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Threads publish is intentionally disabled in code.
                  </span>
                </li>
                <li>
                  <a className="text-primary-700 dark:text-primary-300 font-semibold hover:underline" href="/content/videos">
                    Wire the Instagram video tool once API endpoints are ready
                  </a>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Mirror the ContentPosts flow via Worker/backend once released.
                  </span>
                </li>
                <li>
                  <a className="text-primary-700 dark:text-primary-300 font-semibold hover:underline" href="/library">
                    Keep an eye on the WS clock; events should keep Drafts fresh
                  </a>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    If the footer clock stops, check the Worker↔Backend events bridge.
                  </span>
                </li>
                <li>
                  <a className="text-primary-700 dark:text-primary-300 font-semibold hover:underline" href="/integrations">
                    Refresh Suno credits from Integrations if the cache looks stale
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      <StatusBar />
    </div>
  );
};
