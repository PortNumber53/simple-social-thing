/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type ProviderKey = 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'pinterest' | 'threads';

export type ProviderStatus = {
  connected?: boolean;
  account?: Record<string, unknown>;
};

export type IntegrationsStatus = Partial<Record<ProviderKey, ProviderStatus>>;

export type FacebookPage = { id: string; name: string | null; tasks: string[]; canPost: boolean };

type IntegrationsContextValue = {
  status: IntegrationsStatus | null;
  connectedProviders: ProviderKey[];
  facebookPages: FacebookPage[];
  isLoading: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  refreshFacebookPages: () => Promise<void>;
};

const IntegrationsContext = createContext<IntegrationsContextValue | undefined>(undefined);

export function useIntegrations() {
  const ctx = useContext(IntegrationsContext);
  if (!ctx) throw new Error('useIntegrations must be used within an IntegrationsProvider');
  return ctx;
}

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [status, setStatus] = useState<IntegrationsStatus | null>(() => {
    // Provide immediate "ready" state using cached status; refresh will correct it.
    try {
      const raw = localStorage.getItem('integrations_status');
      return raw ? (JSON.parse(raw) as IntegrationsStatus) : null;
    } catch {
      try { localStorage.removeItem('integrations_status'); } catch { void 0; }
      return null;
    }
  });
  const [facebookPages, setFacebookPages] = useState<FacebookPage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedProviders = useMemo(() => {
    const s = status || {};
    return (Object.keys(s) as ProviderKey[]).filter((k) => !!s[k]?.connected);
  }, [status]);

  const refreshStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/status', { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== 'object') {
        setStatus(null);
        return;
      }
      const obj = data as IntegrationsStatus;
      setStatus(obj);
      try { localStorage.setItem('integrations_status', JSON.stringify(obj)); } catch { void 0; }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshFacebookPages = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/facebook/pages', { credentials: 'include' });
      const data: any = await res.json().catch(() => null);
      if (!res.ok) return;
      const pages = Array.isArray(data?.pages) ? data.pages : [];
      setFacebookPages(
        pages
          .map((p: any) => ({
            id: typeof p?.id === 'string' ? p.id : (p?.id ? String(p.id) : ''),
            name: typeof p?.name === 'string' ? p.name : null,
            tasks: Array.isArray(p?.tasks) ? p.tasks.filter((t: any) => typeof t === 'string') : [],
            canPost: !!p?.canPost,
          }))
          .filter((p: FacebookPage) => p.id),
      );
    } catch { void 0; }
  }, []);

  // Eagerly keep integrations state fresh when app boots or auth changes.
  useEffect(() => {
    // If not authenticated, still attempt (Integrations page is public) but keep it best-effort.
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  // When status indicates Facebook connected, prefetch pages list.
  useEffect(() => {
    if (!connectedProviders.includes('facebook')) return;
    void refreshFacebookPages();
  }, [connectedProviders, refreshFacebookPages]);

  const value: IntegrationsContextValue = {
    status,
    connectedProviders,
    facebookPages,
    isLoading,
    error,
    refreshStatus,
    refreshFacebookPages,
  };

  return <IntegrationsContext.Provider value={value}>{children}</IntegrationsContext.Provider>;
}


