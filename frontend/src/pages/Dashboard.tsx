import React, { useEffect, useMemo, useState } from 'react';
import { TopNavigation } from '../components/TopNavigation';
import { StatusBar } from '../components/StatusBar';
import { useAuth } from '../contexts/AuthContext';
import { useIntegrations, type ProviderKey } from '../contexts/IntegrationsContext';
import { safeStorage } from '../lib/safeStorage';
import { apiJson } from '../lib/api';

type LibraryStats = { drafts: number; scheduled: number };
type TaskStatus = 'shipped' | 'in-progress' | 'setup' | 'blocked' | 'prototype';

const PROVIDERS: ProviderKey[] = ['instagram', 'tiktok', 'facebook', 'youtube', 'pinterest', 'threads'];
const PUBLISH_SUPPORTED: Record<ProviderKey, boolean> = {
  instagram: true,
  facebook: true,
  tiktok: true,
  youtube: true,
  pinterest: true,
  threads: false,
};

const STATUS_STYLES: Record<TaskStatus, { label: string; classes: string }> = {
  shipped: { label: 'Shipped', classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' },
  'in-progress': { label: 'In progress', classes: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' },
  setup: { label: 'Setup needed', classes: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200' },
  blocked: { label: 'Blocked', classes: 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200' },
  prototype: { label: 'Prototype', classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-200' },
};

type SunoSnapshot = { credits: number | null; fetchedAt: string | null; hasKey: boolean };

function StatusPill({ status, label }: { status: TaskStatus; label?: string }) {
  const entry = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold ${entry.classes}`}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-900/60 dark:bg-white/70" />
      {label || entry.label}
    </span>
  );
}

function readSunoSnapshot(): SunoSnapshot {
  const storage = safeStorage();
  const settings = storage.getJSON<Record<string, unknown>>('user_settings') || {};
  const creditsRaw: unknown = (settings as any).suno_credits;
  let credits: number | null = null;
  if (typeof creditsRaw === 'number') credits = creditsRaw;
  if (creditsRaw && typeof creditsRaw === 'object') {
    const c = creditsRaw as Record<string, unknown>;
    if (typeof c.availableCredits === 'number') credits = c.availableCredits as number;
    else if (typeof c.available === 'number') credits = c.available as number;
  }
  const fetchedAt =
    creditsRaw && typeof creditsRaw === 'object' && typeof (creditsRaw as any).fetchedAt === 'string'
      ? ((creditsRaw as any).fetchedAt as string)
      : null;
  const hasKey =
    typeof (settings as any).suno_api_key === 'string' ||
    ((settings as any).suno && typeof (settings as any).suno?.api_key === 'string');
  return { credits, fetchedAt, hasKey: !!hasKey };
}

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { connectedProviders } = useIntegrations();
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);
  const [sunoSnapshot, setSunoSnapshot] = useState<SunoSnapshot>(() => readSunoSnapshot());

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

  useEffect(() => {
    // Keep Suno snapshot in sync with the cached user settings.
    setSunoSnapshot(readSunoSnapshot());
  }, [user?.id]);

  const taskBoard = useMemo(
    () => [
      {
        title: 'OAuth + session bootstrap',
        status: user ? 'shipped' : 'setup',
        detail: user
          ? `Signed in as ${user.email}. AuthContext hydrates from local cache and syncs /api/user-settings.`
          : 'User is not signed in; Google OAuth handled via Worker.',
      },
      {
        title: 'Social integrations',
        status: connectedProviders.length > 0 ? 'in-progress' : 'setup',
        detail: `${connectedProviders.length} connected — Instagram, TikTok, Facebook Pages, YouTube, Pinterest, Threads available via /api/integrations/status.`,
      },
      {
        title: 'Publishing pipeline',
        status: publishReadyProviders.length > 0 ? 'in-progress' : 'setup',
        detail:
          'Post composer calls /api/posts/publish with WebSocket job updates (see ContentPosts + useJobWebSocket). Facebook Pages selection is honored.',
      },
      {
        title: 'Local library + scheduler',
        status: libraryStats ? 'in-progress' : 'setup',
        detail:
          'Draft/scheduled queues served by /api/local-library/items with realtime refresh on post.updated events and publish-now support.',
      },
      {
        title: 'AI music (Suno)',
        status: sunoSnapshot.hasKey ? 'in-progress' : 'setup',
        detail: sunoSnapshot.hasKey
          ? 'Suno API key stored; generator uses /api/integrations/suno/generate with task polling.'
          : 'Add a Suno API key in Integrations to enable generate/sync/credits flow.',
      },
      {
        title: 'Instagram video tool',
        status: 'prototype',
        detail: 'UI placeholder only (ContentVideos) — publishes via setTimeout, no API wiring yet.',
      },
      {
        title: 'Backend + deploy',
        status: 'shipped',
        detail:
          'Go net/http API with Postgres migrations + graceful shutdown, proxied through Worker; Jenkins builds + deploy scripts for backend and Worker.',
      },
    ],
    [connectedProviders.length, libraryStats, publishReadyProviders.length, sunoSnapshot.hasKey, user],
  );

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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-slide-up">
            <div className="card card-hover">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Implementation board</h3>
                <StatusPill status="shipped" label="Reflects current code" />
              </div>
              <div className="divide-y divide-slate-200/70 dark:divide-slate-800/60">
                {taskBoard.map((task) => (
                  <div key={task.title} className="py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{task.title}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{task.detail}</p>
                    </div>
                    <StatusPill status={task.status as TaskStatus} />
                  </div>
                ))}
              </div>
            </div>

            <div className="card card-hover">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">What to do next</h3>
                <StatusPill status="setup" label="Actionable" />
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
