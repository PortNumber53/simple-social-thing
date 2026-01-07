import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useIntegrations } from '../contexts/IntegrationsContext';
import { IntegrationCard } from '../components/IntegrationCard';

type SunoApiKeyResponse = { ok?: boolean; value?: { apiKey?: unknown } };
type ProviderStatusResponse = {
  connected?: boolean;
  account?: Record<string, unknown>;
};
type IntegrationsStatusResponse = {
  instagram?: ProviderStatusResponse;
  tiktok?: ProviderStatusResponse;
  facebook?: ProviderStatusResponse;
  youtube?: ProviderStatusResponse;
  pinterest?: ProviderStatusResponse;
  threads?: ProviderStatusResponse;
};

export const Integrations: React.FC = () => {
  const { status: integrationsStatus, refreshStatus, refreshFacebookPages } = useIntegrations();
  const [igStatus, setIgStatus] = useState<string | null>(null);
  const [igAccount, setIgAccount] = useState<{ id: string; username: string | null } | null>(null);
  const [ttStatus, setTtStatus] = useState<string | null>(null);
  const [ttAccount, setTtAccount] = useState<{ id: string; displayName: string | null } | null>(null);
  const [ttScopes, setTtScopes] = useState<{ scope: string | null; requestedScopes: string | null; hasVideoList: boolean } | null>(null);
  const [fbStatus, setFbStatus] = useState<string | null>(null);
  const [fbAccount, setFbAccount] = useState<{ id: string; name: string | null } | null>(null);
  const [ytStatus, setYtStatus] = useState<string | null>(null);
  const [ytAccount, setYtAccount] = useState<{ id: string; name: string | null } | null>(null);
  const [pinStatus, setPinStatus] = useState<string | null>(null);
  const [pinAccount, setPinAccount] = useState<{ id: string; name: string | null } | null>(null);
  const [thStatus, setThStatus] = useState<string | null>(null);
  const [thAccount, setThAccount] = useState<{ id: string; name: string | null } | null>(null);
  const [sunoApiKey, setSunoApiKey] = useState<string>('');
  const [sunoStatus, setSunoStatus] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ig = params.get('instagram');
    const tt = params.get('tiktok');
    const fb = params.get('facebook');
    const yt = params.get('youtube');
    const pin = params.get('pinterest');
    const th = params.get('threads');
    if (ig) {
      try {
        const data = JSON.parse(decodeURIComponent(ig));
        if (data.success) {
          setIgStatus('Instagram connected successfully.');
          if (data.account && data.account.id) {
            setIgAccount({ id: data.account.id, username: data.account.username ?? null });
            try { localStorage.setItem('ig_conn', JSON.stringify({ id: data.account.id, username: data.account.username ?? null })); } catch { void 0; }
          }
        } else {
          setIgStatus(`Instagram connection failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        setIgStatus('Instagram connection status could not be parsed.');
      } finally {
        // Clean the URL
        window.history.replaceState({}, document.title, '/integrations');
        void refreshStatus();
      }
    } else if (tt) {
      try {
        const data = JSON.parse(decodeURIComponent(tt));
        if (data.success) {
          setTtStatus('TikTok connected successfully.');
          if (data.account && data.account.id) {
            setTtAccount({ id: data.account.id, displayName: data.account.displayName ?? null });
            try { localStorage.setItem('tt_conn', JSON.stringify({ id: data.account.id, displayName: data.account.displayName ?? null })); } catch { void 0; }
          }
        } else {
          setTtStatus(`TikTok connection failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        setTtStatus('TikTok connection status could not be parsed.');
      } finally {
        window.history.replaceState({}, document.title, '/integrations');
        void refreshStatus();
      }
    } else if (fb) {
      try {
        const data = JSON.parse(decodeURIComponent(fb));
        if (data.success) {
          setFbStatus('Facebook connected successfully.');
          if (data.account && data.account.id) {
            setFbAccount({ id: String(data.account.id), name: data.account.name ?? null });
            try { localStorage.setItem('fb_conn', JSON.stringify({ id: String(data.account.id), name: data.account.name ?? null })); } catch { void 0; }
          }
        } else {
          setFbStatus(`Facebook connection failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        setFbStatus('Facebook connection status could not be parsed.');
      } finally {
        window.history.replaceState({}, document.title, '/integrations');
        void refreshStatus();
        void refreshFacebookPages();
      }
    } else if (yt) {
      try {
        const data = JSON.parse(decodeURIComponent(yt));
        if (data.success) {
          setYtStatus('YouTube connected successfully.');
          if (data.account && data.account.id) {
            setYtAccount({ id: String(data.account.id), name: data.account.name ?? null });
            try { localStorage.setItem('yt_conn', JSON.stringify({ id: String(data.account.id), name: data.account.name ?? null })); } catch { void 0; }
          }
        } else {
          setYtStatus(`YouTube connection failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        setYtStatus('YouTube connection status could not be parsed.');
      } finally {
        window.history.replaceState({}, document.title, '/integrations');
        void refreshStatus();
      }
    } else if (pin) {
      try {
        const data = JSON.parse(decodeURIComponent(pin));
        if (data.success) {
          setPinStatus('Pinterest connected successfully.');
          if (data.account && data.account.id) {
            setPinAccount({ id: String(data.account.id), name: data.account.name ?? null });
            try { localStorage.setItem('pin_conn', JSON.stringify({ id: String(data.account.id), name: data.account.name ?? null })); } catch { void 0; }
          }
        } else {
          setPinStatus(`Pinterest connection failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        setPinStatus('Pinterest connection status could not be parsed.');
      } finally {
        window.history.replaceState({}, document.title, '/integrations');
        void refreshStatus();
      }
    } else if (th) {
      try {
        const data = JSON.parse(decodeURIComponent(th));
        if (data.success) {
          setThStatus('Threads connected successfully.');
          if (data.account && data.account.id) {
            setThAccount({ id: String(data.account.id), name: data.account.name ?? null });
            try { localStorage.setItem('th_conn', JSON.stringify({ id: String(data.account.id), name: data.account.name ?? null })); } catch { void 0; }
          }
        } else {
          setThStatus(`Threads connection failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        setThStatus('Threads connection status could not be parsed.');
      } finally {
        window.history.replaceState({}, document.title, '/integrations');
        void refreshStatus();
      }
    } else {
      // Load existing connection from localStorage if present
      try {
        const raw = localStorage.getItem('ig_conn');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setIgAccount({ id: String(parsed.id), username: parsed.username ?? null });
          }
        }
      } catch { void 0; }
      try {
        const raw = localStorage.getItem('tt_conn');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setTtAccount({ id: String(parsed.id), displayName: parsed.displayName ?? null });
          }
        }
      } catch { void 0; }
      try {
        const raw = localStorage.getItem('fb_conn');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setFbAccount({ id: String(parsed.id), name: parsed.name ?? null });
          }
        }
      } catch { void 0; }
      try {
        const raw = localStorage.getItem('yt_conn');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setYtAccount({ id: String(parsed.id), name: parsed.name ?? null });
          }
        }
      } catch { void 0; }
      try {
        const raw = localStorage.getItem('pin_conn');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setPinAccount({ id: String(parsed.id), name: parsed.name ?? null });
          }
        }
      } catch { void 0; }
      try {
        const raw = localStorage.getItem('th_conn');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setThAccount({ id: String(parsed.id), name: parsed.name ?? null });
          }
        }
      } catch { void 0; }
    }
  }, []);

  useEffect(() => {
    // Ensure we have a fresh app-wide status when opening this page.
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    // Keep local page state in sync with app-wide integrations state.
    if (!integrationsStatus) return;
    const obj = integrationsStatus as IntegrationsStatusResponse;

    if (obj.instagram?.connected) {
      const a = obj.instagram.account || {};
      const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
      const username = typeof a.username === 'string' ? a.username : null;
      if (id) setIgAccount({ id, username });
    } else {
      setIgAccount(null);
      try { localStorage.removeItem('ig_conn'); } catch { void 0; }
    }
    if (obj.tiktok?.connected) {
      const a = obj.tiktok.account || {};
      const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
      const displayName = typeof a.displayName === 'string' ? a.displayName : null;
      if (id) setTtAccount({ id, displayName });
    } else {
      setTtAccount(null);
      try { localStorage.removeItem('tt_conn'); } catch { void 0; }
    }
    if (obj.facebook?.connected) {
      const a = obj.facebook.account || {};
      const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
      const name = typeof a.name === 'string' ? a.name : null;
      if (id) setFbAccount({ id, name });
    } else {
      setFbAccount(null);
      try { localStorage.removeItem('fb_conn'); } catch { void 0; }
    }
    if (obj.youtube?.connected) {
      const a = obj.youtube.account || {};
      const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
      const name = typeof a.name === 'string' ? a.name : null;
      if (id) setYtAccount({ id, name });
    } else {
      setYtAccount(null);
      try { localStorage.removeItem('yt_conn'); } catch { void 0; }
    }
    if (obj.pinterest?.connected) {
      const a = obj.pinterest.account || {};
      const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
      const name = typeof a.name === 'string' ? a.name : null;
      if (id) setPinAccount({ id, name });
    } else {
      setPinAccount(null);
      try { localStorage.removeItem('pin_conn'); } catch { void 0; }
    }
    if (obj.threads?.connected) {
      const a = obj.threads.account || {};
      const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
      const name = typeof a.name === 'string' ? a.name : null;
      if (id) setThAccount({ id, name });
    } else {
      setThAccount(null);
      try { localStorage.removeItem('th_conn'); } catch { void 0; }
    }
  }, [integrationsStatus]);

  useEffect(() => {
    // Fetch TikTok granted scopes (without exposing tokens) so we can surface "video import enabled" state.
    const loadTikTokScopes = async () => {
      try {
        const res = await fetch('/api/integrations/tiktok/scopes', { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok || !data || typeof data !== 'object') return;
        const obj = data as Record<string, unknown>;
        const ok = obj.ok === true;
        if (!ok) return;
        setTtScopes({
          scope: typeof obj.scope === 'string' ? obj.scope : null,
          requestedScopes: typeof obj.requestedScopes === 'string' ? obj.requestedScopes : null,
          hasVideoList: obj.hasVideoList === true,
        });
      } catch { void 0; }
    };
    if (ttAccount) loadTikTokScopes();
  }, [ttAccount]);

  useEffect(() => {
    // Load user-specific Suno API key via worker (requires sid cookie)
    const load = async () => {
      try {
        const res = await fetch(`/api/integrations/suno/api-key`, { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        const parsed: SunoApiKeyResponse | null = data && typeof data === 'object' ? (data as SunoApiKeyResponse) : null;
        if (parsed?.ok && typeof parsed.value?.apiKey === 'string' && parsed.value.apiKey.trim() !== '') {
          setSunoApiKey(parsed.value.apiKey);
        }
      } catch { void 0; }
    };
    load();
  }, []);

  const startInstagramAuth = () => {
    window.location.href = `/api/integrations/instagram/auth`;
  };

  const startTikTokAuth = () => {
    window.location.href = `/api/integrations/tiktok/auth`;
  };

  const enableTikTokVideoImport = () => {
    // Requests the extra `video.list` scope so backend imports can fetch videos.
    window.location.href = `/api/integrations/tiktok/auth?scope=video.list`;
  };

  const startFacebookAuth = () => {
    window.location.href = `/api/integrations/facebook/auth`;
  };

  const startYouTubeAuth = () => {
    window.location.href = `/api/integrations/youtube/auth`;
  };

  const startPinterestAuth = () => {
    window.location.href = `/api/integrations/pinterest/auth`;
  };

  const startThreadsAuth = () => {
    window.location.href = `/api/integrations/threads/auth`;
  };


  const saveSunoApiKey = async () => {
    setSunoStatus('Saving Suno API key...');
    try {
      const res = await fetch(`/api/integrations/suno/api-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: sunoApiKey }),
        credentials: 'include',
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const err = obj && typeof obj.error === 'string' ? obj.error : null;
        const backendOrigin = obj && typeof obj.backendOrigin === 'string' ? obj.backendOrigin : null;
        if (err === 'backend_unreachable') {
          setSunoStatus(`Backend unreachable (${backendOrigin || 'unknown'}). Is the backend running on 18911?`);
        } else {
          setSunoStatus(`Failed to save Suno API key (${res.status}).`);
        }
        return;
      }
      setSunoStatus('Suno API key saved.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSunoStatus(`Failed to save Suno API key: ${msg}`);
    }
  };

  const disconnectInstagram = async () => {
    try { localStorage.removeItem('ig_conn'); } catch { void 0; }
    setIgAccount(null);
    setIgStatus('Instagram disconnected.');
    // Best-effort tell worker to clear cookie
    try {
      await fetch(`/api/integrations/instagram/disconnect`, { method: 'POST', credentials: 'include' });
    } catch { void 0; }
  };

  const disconnectTikTok = async () => {
    try { localStorage.removeItem('tt_conn'); } catch { void 0; }
    setTtAccount(null);
    setTtStatus('TikTok disconnected.');
    try {
      await fetch(`/api/integrations/tiktok/disconnect`, { method: 'POST', credentials: 'include' });
    } catch { void 0; }
  };

  const disconnectFacebook = async () => {
    try { localStorage.removeItem('fb_conn'); } catch { void 0; }
    setFbAccount(null);
    setFbStatus('Facebook disconnected.');
    try {
      await fetch(`/api/integrations/facebook/disconnect`, { method: 'POST', credentials: 'include' });
    } catch { void 0; }
  };

  const disconnectYouTube = async () => {
    try { localStorage.removeItem('yt_conn'); } catch { void 0; }
    setYtAccount(null);
    setYtStatus('YouTube disconnected.');
    try { await fetch(`/api/integrations/youtube/disconnect`, { method: 'POST', credentials: 'include' }); } catch { void 0; }
  };

  const disconnectPinterest = async () => {
    try { localStorage.removeItem('pin_conn'); } catch { void 0; }
    setPinAccount(null);
    setPinStatus('Pinterest disconnected.');
    try { await fetch(`/api/integrations/pinterest/disconnect`, { method: 'POST', credentials: 'include' }); } catch { void 0; }
  };

  const disconnectThreads = async () => {
    try { localStorage.removeItem('th_conn'); } catch { void 0; }
    setThAccount(null);
    setThStatus('Threads disconnected.');
    try { await fetch(`/api/integrations/threads/disconnect`, { method: 'POST', credentials: 'include' }); } catch { void 0; }
  };
  const notices = [
    { key: 'ig', msg: igStatus },
    { key: 'tt', msg: ttStatus },
    { key: 'fb', msg: fbStatus },
    { key: 'yt', msg: ytStatus },
    { key: 'pin', msg: pinStatus },
    { key: 'th', msg: thStatus },
  ].filter((n): n is { key: string; msg: string } => !!n.msg);

  const noticeStyle = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes('failed') || m.includes('error')) {
      return 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300';
    }
    if (m.includes('disconnected')) {
      return 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-200';
    }
    return 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300';
  };

  return (
    <Layout>
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-6 sm:space-y-8">
        <header className="text-left sm:text-center space-y-2 sm:space-y-3">
          <h1 className="gradient-text text-3xl sm:text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-1 sm:pb-2">
            Integrations
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-base sm:text-lg max-w-prose sm:mx-auto">
            Connect your social accounts to schedule posts, manage messages, and get notifications.
          </p>
        </header>

        {notices.length > 0 && (
          <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
            {notices.map((n) => (
              <div
                key={n.key}
                className={`p-3 rounded-md text-sm shadow-lg border border-slate-200/70 dark:border-slate-700/70 ${noticeStyle(n.msg)}`}
                role="status"
                aria-live="polite"
                title={n.msg}
              >
                {n.msg}
              </div>
            ))}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm5-1.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
                </svg>
              </div>
            }
            title="Instagram"
            description="Connect Instagram to schedule posts, manage DMs and comments, and receive notifications."
          >
            {igAccount ? (
              <>
                <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm max-w-full break-words">
                  Connected{igAccount.username ? ` as @${igAccount.username}` : ''}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                  <button onClick={disconnectInstagram} className="btn btn-ghost w-full sm:w-auto">Disconnect</button>
                  <a href="/help/instagram" className="btn btn-secondary w-full sm:w-auto">Learn more</a>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                <button onClick={startInstagramAuth} className="btn btn-primary w-full sm:w-auto">
                  Connect <span className="hidden sm:inline">Instagram</span>
                </button>
                <a href="/help/instagram" className="btn btn-secondary w-full sm:w-auto">Learn more</a>
              </div>
            )}
          </IntegrationCard>

          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-lg">
                <span className="text-white text-lg font-bold">f</span>
              </div>
            }
            title="Facebook"
            description="Connect Facebook pages to import posts into Published."
          >
            {fbAccount ? (
              <>
                <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm max-w-full break-words">
                  Connected{fbAccount.name ? ` as ${fbAccount.name}` : ''}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                  <button onClick={disconnectFacebook} className="btn btn-ghost w-full sm:w-auto">Disconnect</button>
                  <a href="https://developers.facebook.com/docs/facebook-login/" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                    Learn more
                  </a>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                <button onClick={startFacebookAuth} className="btn btn-primary w-full sm:w-auto">
                  Connect <span className="hidden sm:inline">Facebook</span>
                </button>
                <a href="https://developers.facebook.com/docs/facebook-login/" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                  Learn more
                </a>
              </div>
            )}
          </IntegrationCard>

          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-red-600 to-red-400 flex items-center justify-center shadow-lg">
                <span className="text-white text-lg font-bold">▶</span>
              </div>
            }
            title="YouTube"
            description="Connect YouTube to import your uploaded videos into Published."
          >
            {ytAccount ? (
              <>
                <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm max-w-full break-words">
                  Connected{ytAccount.name ? ` as ${ytAccount.name}` : ''}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                  <button onClick={disconnectYouTube} className="btn btn-ghost w-full sm:w-auto">Disconnect</button>
                  <a href="https://developers.google.com/youtube/v3/docs" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                    Learn more
                  </a>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                <button onClick={startYouTubeAuth} className="btn btn-primary w-full sm:w-auto">
                  Connect <span className="hidden sm:inline">YouTube</span>
                </button>
                <a href="https://developers.google.com/youtube/v3/docs" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                  Learn more
                </a>
              </div>
            )}
          </IntegrationCard>

          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-rose-600 to-red-500 flex items-center justify-center shadow-lg">
                <span className="text-white text-lg font-bold">P</span>
              </div>
            }
            title="Pinterest"
            description="Connect Pinterest to import pins into Published."
          >
            {pinAccount ? (
              <>
                <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm max-w-full break-words">
                  Connected{pinAccount.name ? ` as ${pinAccount.name}` : ''}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                  <button onClick={disconnectPinterest} className="btn btn-ghost w-full sm:w-auto">Disconnect</button>
                  <a href="https://developers.pinterest.com/" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                    Learn more
                  </a>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                <button onClick={startPinterestAuth} className="btn btn-primary w-full sm:w-auto">
                  Connect <span className="hidden sm:inline">Pinterest</span>
                </button>
                <a href="https://developers.pinterest.com/" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                  Learn more
                </a>
              </div>
            )}
          </IntegrationCard>

          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-slate-900 to-slate-500 flex items-center justify-center shadow-lg">
                <span className="text-white text-lg font-bold">@</span>
              </div>
            }
            title="Threads"
            description="Connect Threads to import posts into Published."
          >
            {thAccount ? (
              <>
                <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm max-w-full break-words">
                  Connected{thAccount.name ? ` as ${thAccount.name}` : ''}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                  <button onClick={disconnectThreads} className="btn btn-ghost w-full sm:w-auto">Disconnect</button>
                  <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                    Learn more
                  </a>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                <button onClick={startThreadsAuth} className="btn btn-primary w-full sm:w-auto">
                  Connect <span className="hidden sm:inline">Threads</span>
                </button>
                <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer" className="btn btn-secondary w-full sm:w-auto">
                  Learn more
                </a>
              </div>
            )}
          </IntegrationCard>

          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-black to-pink-500 flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M14.5 3a1 1 0 0 1 1 1c0 3.1 2.4 5.5 5.5 5.5a1 1 0 1 1 0 2c-1.8 0-3.5-.6-4.9-1.6V16a6 6 0 1 1-6-6 1 1 0 1 1 0 2 4 4 0 1 0 4 4V4a1 1 0 0 1 1-1z" />
                </svg>
              </div>
            }
            title={
              <span className="inline-flex items-center gap-2 flex-wrap">
                <span>TikTok</span>
                {ttAccount ? (
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-xs">
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-xs">
                    Login Kit
                  </span>
                )}
              </span>
            }
            description="We’ll integrate TikTok so you can authenticate users, share content, publish posts, and receive webhooks."
          >
            <div className="text-sm text-slate-700 dark:text-slate-200 hidden md:block">
              <div className="font-medium text-slate-900 dark:text-slate-100 mb-1">Planned products</div>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                <li><strong>Login Kit</strong> (OAuth)</li>
                <li><strong>Share Kit</strong></li>
                <li><strong>Content Posting API</strong></li>
                <li><strong>Webhooks</strong></li>
              </ul>
            </div>
            <details className="md:hidden rounded-lg border border-slate-200/60 dark:border-slate-700/50 bg-white/50 dark:bg-slate-900/20">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                Planned products
              </summary>
              <div className="px-3 pb-3">
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  <li><strong>Login Kit</strong> (OAuth)</li>
                  <li><strong>Share Kit</strong></li>
                  <li><strong>Content Posting API</strong></li>
                  <li><strong>Webhooks</strong></li>
                </ul>
              </div>
            </details>

            {ttAccount ? (
              <>
                <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm max-w-full break-words">
                  Connected{ttAccount.displayName ? ` as ${ttAccount.displayName}` : ''}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                  <button onClick={disconnectTikTok} className="btn btn-ghost w-full sm:w-auto">Disconnect</button>
                  <button onClick={enableTikTokVideoImport} className="btn btn-secondary w-full sm:w-auto" type="button">
                    Enable video import
                  </button>
                  <a
                    href="https://developers.tiktok.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary w-full col-span-2 sm:col-span-1 sm:w-auto"
                  >
                    TikTok developer docs
                  </a>
                </div>
                {ttScopes && (
                  <span className={`text-xs ${ttScopes.hasVideoList ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'} break-words`}>
                    {ttScopes.hasVideoList ? 'Video import enabled' : 'Video import NOT enabled (needs video.list)'}
                  </span>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                <button onClick={startTikTokAuth} className="btn btn-primary w-full sm:w-auto">
                  Connect <span className="hidden sm:inline">TikTok</span>
                </button>
                <a
                  href="https://developers.tiktok.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  <span className="sm:hidden">Docs</span>
                  <span className="hidden sm:inline">TikTok developer docs</span>
                </a>
              </div>
            )}
          </IntegrationCard>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <IntegrationCard
            icon={
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-amber-500 to-red-500 flex items-center justify-center shadow-lg">
                <span className="text-white text-lg font-bold">S</span>
              </div>
            }
            title="Suno (API key)"
            description="Your key is stored per-user in the backend (`UserSettings`)."
          >
            <div className="space-y-3">
              <input
                value={sunoApiKey}
                onChange={(e) => setSunoApiKey(e.target.value)}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Enter your Suno API key"
              />
              <button onClick={saveSunoApiKey} className="btn btn-primary w-full sm:w-auto">Save key</button>
              {sunoStatus && (
                <p className="text-sm text-slate-600 dark:text-slate-400">{sunoStatus}</p>
              )}
            </div>
          </IntegrationCard>
        </section>

      </div>
    </Layout>
  );
}
