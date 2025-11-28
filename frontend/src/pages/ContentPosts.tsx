import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';

interface MediaPreview {
	id: string;
	file: File;
	url: string;
}

type IntegrationsStatusResponse = Record<
  string,
  {
    connected?: boolean;
    account?: Record<string, unknown>;
  }
>;

type PublishResponse = {
  ok?: boolean;
  results?: Record<string, { ok?: boolean; posted?: number; error?: string; details?: unknown }>;
  error?: string;
  status?: number;
  body?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook Pages',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  threads: 'Threads',
};

export const ContentPosts: React.FC = () => {
	const [caption, setCaption] = useState<string>('');
	const [media, setMedia] = useState<MediaPreview[]>([]);
	const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<PublishResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectAll, setSelectAll] = useState(true);
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/integrations/status', { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        const obj = (data && typeof data === 'object') ? (data as IntegrationsStatusResponse) : null;
        if (!obj) return;
        const conns = Object.keys(obj).filter((k) => !!obj[k]?.connected);
        setConnected(conns);
        // Default select all connected
        const next: Record<string, boolean> = {};
        for (const p of conns) next[p] = true;
        setSelected(next);
        setSelectAll(true);
      } catch { void 0; }
    };
    void load();
  }, []);

  const selectedProviders = useMemo(() => {
    return Object.keys(selected).filter((k) => selected[k]);
  }, [selected]);

  useEffect(() => {
    // Keep "select all" in sync when user toggles individuals
    if (connected.length === 0) return;
    const allOn = connected.every((p) => selected[p]);
    setSelectAll(allOn);
  }, [connected, selected]);

	const onFiles = (files: FileList | null) => {
		if (!files) return;
		const next: MediaPreview[] = [];
		Array.from(files).forEach((file) => {
			const url = URL.createObjectURL(file);
			next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, url });
		});
		setMedia((prev) => [...prev, ...next]);
	};

	const removeMedia = (id: string) => {
		setMedia((prev) => prev.filter((m) => m.id !== id));
	};

	const submit = async () => {
    setResults(null);
    setShowDetails({});
    if (!caption.trim()) {
      setStatus('Please write a caption.');
      return;
    }
    if (selectedProviders.length === 0) {
      setStatus('Select at least one connected network.');
      return;
    }
    setIsSubmitting(true);
		setStatus(`Publishing to ${selectedProviders.length} network(s)...`);
    try {
      const res = await fetch('/api/posts/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ caption, providers: selectedProviders }),
      });
      const data: PublishResponse = await res.json().catch(() => ({}));
      setResults(data);
      const resultMap = data?.results && typeof data.results === 'object' ? data.results : null;
      const anyFail = !!resultMap && Object.values(resultMap).some((r) => !r?.ok);
      if (!res.ok) {
        setStatus(`Publish failed: ${data.error || 'Unknown error'}`);
      } else if (anyFail) {
        setStatus('Publish completed with errors. Expand Results for details.');
      } else {
        setStatus('Publish completed successfully.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResults({ ok: false, error: msg });
      setStatus(`Publish failed: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
	};

	return (
		<Layout headerPaddingClass="pt-24">
			<div className="max-w-5xl mx-auto space-y-8">
				<header className="space-y-2">
					<h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Publish Post</h1>
					<p className="text-slate-600 dark:text-slate-400 text-sm">
            Choose which connected networks to publish to.
					</p>
				</header>
				<div className="bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-6 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Networks</label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSelectAll(v);
                    const next: Record<string, boolean> = { ...selected };
                    for (const p of connected) next[p] = v;
                    setSelected(next);
                  }}
                />
                Post to all connected
              </label>
            </div>
            {connected.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-300">
                No connected networks yet. Go to <a href="/integrations" className="underline">Integrations</a> to connect.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {connected.map((p) => (
                  <label key={p} className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!selected[p]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [p]: e.target.checked }))}
                    />
                    <span className="text-slate-800 dark:text-slate-100">{PROVIDER_LABELS[p] || p}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Note: publishing support is incremental. Currently the backend supports caption-only publishing for Facebook Pages; other networks may report <span className="font-mono">not_supported_yet</span>.
            </p>
          </div>
					<div className="space-y-2">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-200">Caption</label>
						<textarea
							value={caption}
							onChange={(e) => setCaption(e.target.value)}
							rows={3}
							className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
						/>
					</div>
					<div className="space-y-3">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-200">Media (images)</label>
						<input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.target.files)} />
						{media.length > 0 && (
							<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
								{media.map((m) => (
									<div key={m.id} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
										<img src={m.url} alt="preview" className="w-full h-32 object-cover" />
										<button
											onClick={() => removeMedia(m.id)}
											type="button"
											className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
										>
											×
										</button>
									</div>
								))}
							</div>
						)}
						<p className="text-xs text-slate-500 dark:text-slate-400">Tip: upload 2+ images to make a carousel.</p>
					</div>
					<div className="flex gap-3 items-center">
						<button onClick={submit} className="btn btn-primary" disabled={isSubmitting || connected.length === 0}>
              {isSubmitting ? 'Publishing…' : 'Publish'}
            </button>
						{status && <span className="text-sm text-slate-500 dark:text-slate-300">{status}</span>}
					</div>
          {results?.results && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Results</div>
              <div className="space-y-1 text-sm">
                {Object.entries(results.results).map(([provider, r]) => (
                  <div key={provider} className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-slate-700 dark:text-slate-200">{PROVIDER_LABELS[provider] || provider}</div>
                      <div className="text-right text-slate-600 dark:text-slate-300">
                        {r.ok ? (
                          <span>ok{typeof r.posted === 'number' ? ` (posted ${r.posted})` : ''}</span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400">{r.error || 'error'}</span>
                        )}
                      </div>
                    </div>
                    {!r.ok && r.details != null && (
                      <div>
                        <button
                          type="button"
                          className="text-xs underline text-slate-600 dark:text-slate-300"
                          onClick={() => setShowDetails((prev) => ({ ...prev, [provider]: !prev[provider] }))}
                        >
                          {showDetails[provider] ? 'Hide details' : 'Show details'}
                        </button>
                        {showDetails[provider] && (
                          <div className="mt-2 rounded-md bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 p-3">
                            {provider === 'facebook' ? (
                              <FacebookPublishDetails details={r.details} />
                            ) : (
                              <pre className="text-xs whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
                                {JSON.stringify(r.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
				</div>
			</div>
		</Layout>
	);
};

function FacebookPublishDetails({ details }: { details: unknown }) {
  try {
    const obj = details as any;
    const pages = Array.isArray(obj?.pages) ? obj.pages : [];
    if (!pages.length) {
      return (
        <pre className="text-xs whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
          {JSON.stringify(details, null, 2)}
        </pre>
      );
    }
    return (
      <div className="space-y-2">
        <div className="text-xs text-slate-600 dark:text-slate-300">Per-page results:</div>
        <div className="space-y-1">
          {pages.map((p: any, idx: number) => (
            <div key={`${p?.pageId || idx}`} className="flex items-start justify-between gap-3 text-xs">
              <div className="font-mono text-slate-700 dark:text-slate-200">{String(p?.pageId || '')}</div>
              <div className="text-right">
                {p?.posted ? (
                  <span className="text-emerald-700 dark:text-emerald-300">posted</span>
                ) : (
                  <span className="text-rose-700 dark:text-rose-300">
                    {String(p?.error || 'error')}
                    {p?.statusCode ? ` (HTTP ${p.statusCode})` : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  } catch {
    return (
      <pre className="text-xs whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
        {JSON.stringify(details, null, 2)}
      </pre>
    );
  }
}
