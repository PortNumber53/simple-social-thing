import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';

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
  const [igStatus, setIgStatus] = useState<string | null>(null);
  const [igAccount, setIgAccount] = useState<{ id: string; username: string | null } | null>(null);
  const [ttStatus, setTtStatus] = useState<string | null>(null);
  const [ttAccount, setTtAccount] = useState<{ id: string; displayName: string | null } | null>(null);
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
    // Prefer live status from worker so UI stays correct across devices.
    const loadStatus = async () => {
      try {
        const res = await fetch('/api/integrations/status', { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok || !data || typeof data !== 'object') return;
        const obj = data as IntegrationsStatusResponse;

        if (obj.instagram?.connected) {
          const a = obj.instagram.account || {};
          const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
          const username = typeof a.username === 'string' ? a.username : null;
          if (id) setIgAccount({ id, username });
        }
        if (obj.tiktok?.connected) {
          const a = obj.tiktok.account || {};
          const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
          const displayName = typeof a.displayName === 'string' ? a.displayName : null;
          if (id) setTtAccount({ id, displayName });
        }
        if (obj.facebook?.connected) {
          const a = obj.facebook.account || {};
          const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
          const name = typeof a.name === 'string' ? a.name : null;
          if (id) setFbAccount({ id, name });
        }
        if (obj.youtube?.connected) {
          const a = obj.youtube.account || {};
          const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
          const name = typeof a.name === 'string' ? a.name : null;
          if (id) setYtAccount({ id, name });
        }
        if (obj.pinterest?.connected) {
          const a = obj.pinterest.account || {};
          const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
          const name = typeof a.name === 'string' ? a.name : null;
          if (id) setPinAccount({ id, name });
        }
        if (obj.threads?.connected) {
          const a = obj.threads.account || {};
          const id = typeof a.id === 'string' ? a.id : String(a.id ?? '');
          const name = typeof a.name === 'string' ? a.name : null;
          if (id) setThAccount({ id, name });
        }
      } catch { void 0; }
    };
    loadStatus();
  }, []);

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
  return (
    <Layout>
        <div className="max-w-5xl mx-auto space-y-8">
        <header className="text-center space-y-3">
          <h1 className="gradient-text text-4xl md:text-5xl font-extrabold leading-[1.15] inline-block pb-2">Integrations</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Connect your social accounts to schedule posts, manage messages, and get notifications.
          </p>
        </header>

        {igStatus && (
          <div className="max-w-xl mx-auto">
            <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm text-center">
              {igStatus}
            </div>
          </div>
        )}
        {ttStatus && (
          <div className="max-w-xl mx-auto">
            <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm text-center">
              {ttStatus}
            </div>
          </div>
        )}
        {fbStatus && (
          <div className="max-w-xl mx-auto">
            <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm text-center">
              {fbStatus}
            </div>
          </div>
        )}
        {ytStatus && (
          <div className="max-w-xl mx-auto">
            <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm text-center">
              {ytStatus}
            </div>
          </div>
        )}
        {pinStatus && (
          <div className="max-w-xl mx-auto">
            <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm text-center">
              {pinStatus}
            </div>
          </div>
        )}
        {thStatus && (
          <div className="max-w-xl mx-auto">
            <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm text-center">
              {thStatus}
            </div>
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center shadow-lg">
              {/* Instagram-like glyph */}
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm5-1.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Instagram</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Connect Instagram to schedule posts, manage DMs and comments, and receive notifications.
              </p>
              <div className="mt-4 flex gap-3">
                {igAccount ? (
                  <>
                    <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm">
                      Connected{igAccount.username ? ` as @${igAccount.username}` : ''}
                    </span>
                    <button onClick={disconnectInstagram} className="btn btn-ghost">Disconnect</button>
                  </>
                ) : (
                  <button onClick={startInstagramAuth} className="btn btn-primary">Connect Instagram</button>
                )}
                <a href="/help/instagram" className="btn btn-secondary">Learn more</a>
              </div>
            </div>
          </div>

          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-lg">
              <span className="text-white text-lg font-bold">f</span>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Facebook</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Connect Facebook pages to import posts into your Library.
              </p>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                {fbAccount ? (
                  <>
                    <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm">
                      Connected{fbAccount.name ? ` as ${fbAccount.name}` : ''}
                    </span>
                    <button onClick={disconnectFacebook} className="btn btn-ghost">Disconnect</button>
                  </>
                ) : (
                  <button onClick={startFacebookAuth} className="btn btn-primary">Connect Facebook</button>
                )}
                <a href="https://developers.facebook.com/docs/facebook-login/" target="_blank" rel="noreferrer" className="btn btn-secondary">
                  Learn more
                </a>
              </div>
            </div>
          </div>

          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-600 to-red-400 flex items-center justify-center shadow-lg">
              <span className="text-white text-lg font-bold">▶</span>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">YouTube</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Connect YouTube to import your uploaded videos into the Library.
              </p>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                {ytAccount ? (
                  <>
                    <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm">
                      Connected{ytAccount.name ? ` as ${ytAccount.name}` : ''}
                    </span>
                    <button onClick={disconnectYouTube} className="btn btn-ghost">Disconnect</button>
                  </>
                ) : (
                  <button onClick={startYouTubeAuth} className="btn btn-primary">Connect YouTube</button>
                )}
                <a href="https://developers.google.com/youtube/v3/docs" target="_blank" rel="noreferrer" className="btn btn-secondary">
                  Learn more
                </a>
              </div>
            </div>
          </div>

          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-600 to-red-500 flex items-center justify-center shadow-lg">
              <span className="text-white text-lg font-bold">P</span>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Pinterest</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Connect Pinterest to import pins into the Library.
              </p>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                {pinAccount ? (
                  <>
                    <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm">
                      Connected{pinAccount.name ? ` as ${pinAccount.name}` : ''}
                    </span>
                    <button onClick={disconnectPinterest} className="btn btn-ghost">Disconnect</button>
                  </>
                ) : (
                  <button onClick={startPinterestAuth} className="btn btn-primary">Connect Pinterest</button>
                )}
                <a href="https://developers.pinterest.com/" target="_blank" rel="noreferrer" className="btn btn-secondary">
                  Learn more
                </a>
              </div>
            </div>
          </div>

          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-900 to-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-white text-lg font-bold">@</span>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Threads</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Connect Threads to import posts into the Library.
              </p>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                {thAccount ? (
                  <>
                    <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm">
                      Connected{thAccount.name ? ` as ${thAccount.name}` : ''}
                    </span>
                    <button onClick={disconnectThreads} className="btn btn-ghost">Disconnect</button>
                  </>
                ) : (
                  <button onClick={startThreadsAuth} className="btn btn-primary">Connect Threads</button>
                )}
                <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer" className="btn btn-secondary">
                  Learn more
                </a>
              </div>
            </div>
          </div>

          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-black to-pink-500 flex items-center justify-center shadow-lg">
              {/* TikTok-ish note icon */}
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M14.5 3a1 1 0 0 1 1 1c0 3.1 2.4 5.5 5.5 5.5a1 1 0 1 1 0 2c-1.8 0-3.5-.6-4.9-1.6V16a6 6 0 1 1-6-6 1 1 0 1 1 0 2 4 4 0 1 0 4 4V4a1 1 0 0 1 1-1z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">TikTok</h2>
                {ttAccount ? (
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-xs">
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-xs">
                    Login Kit
                  </span>
                )}
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                We’ll integrate TikTok so you can authenticate users, share content, publish posts, and receive webhooks.
              </p>
              <div className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                <div className="font-medium text-slate-900 dark:text-slate-100 mb-1">Planned products</div>
                <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
                  <li><strong>Login Kit</strong> (OAuth)</li>
                  <li><strong>Share Kit</strong></li>
                  <li><strong>Content Posting API</strong></li>
                  <li><strong>Webhooks</strong></li>
                </ul>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                {ttAccount ? (
                  <>
                    <span className="inline-flex items-center px-3 py-2 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 text-sm">
                      Connected{ttAccount.displayName ? ` as ${ttAccount.displayName}` : ''}
                    </span>
                    <button onClick={disconnectTikTok} className="btn btn-ghost">Disconnect</button>
                    <button onClick={enableTikTokVideoImport} className="btn btn-secondary" type="button">
                      Enable video import
                    </button>
                  </>
                ) : (
                  <button onClick={startTikTokAuth} className="btn btn-primary">
                    Connect TikTok
                  </button>
                )}
                <a
                  href="https://developers.tiktok.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                >
                  TikTok developer docs
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-red-500 flex items-center justify-center shadow-lg">
              <span className="text-white text-lg font-bold">S</span>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Suno (API key)</h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Your key is stored per-user in the backend (`UserSettings`).
              </p>
              <div className="mt-4 space-y-3">
                <input
                  value={sunoApiKey}
                  onChange={(e) => setSunoApiKey(e.target.value)}
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="Enter your Suno API key"
                />
                <button onClick={saveSunoApiKey} className="btn btn-primary">Save key</button>
                {sunoStatus && (
                  <p className="text-sm text-slate-600 dark:text-slate-400">{sunoStatus}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        </div>
    </Layout>
  );
}
