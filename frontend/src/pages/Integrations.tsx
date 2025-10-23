import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';

export const Integrations: React.FC = () => {
  const [igStatus, setIgStatus] = useState<string | null>(null);
  const [igAccount, setIgAccount] = useState<{ id: string; username: string | null } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ig = params.get('instagram');
    if (ig) {
      try {
        const data = JSON.parse(decodeURIComponent(ig));
        if (data.success) {
          setIgStatus('Instagram connected successfully.');
          if (data.account && data.account.id) {
            setIgAccount({ id: data.account.id, username: data.account.username ?? null });
            try { localStorage.setItem('ig_conn', JSON.stringify({ id: data.account.id, username: data.account.username ?? null })); } catch {}
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
      } catch {}
    }
  }, []);

  const startInstagramAuth = () => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const workerOrigin = (isLocalhost && import.meta.env.VITE_WORKER_ORIGIN)
      ? import.meta.env.VITE_WORKER_ORIGIN
      : window.location.origin;
    window.location.href = `${workerOrigin}/api/integrations/instagram/auth`;
  };

  const disconnectInstagram = async () => {
    try { localStorage.removeItem('ig_conn'); } catch {}
    setIgAccount(null);
    setIgStatus('Instagram disconnected.');
    // Best-effort tell worker to clear cookie
    try {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const workerOrigin = (isLocalhost && import.meta.env.VITE_WORKER_ORIGIN)
        ? import.meta.env.VITE_WORKER_ORIGIN
        : window.location.origin;
      await fetch(`${workerOrigin}/api/integrations/instagram/disconnect`, { method: 'POST' });
    } catch {}
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
        </section>
        </div>
    </Layout>
  );
}
