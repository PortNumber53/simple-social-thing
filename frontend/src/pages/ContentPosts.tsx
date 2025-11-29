import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../components/Layout';
import { useIntegrations } from '../contexts/IntegrationsContext';

interface MediaPreview {
	id: string;
	file: File;
	url: string;
}

type PublishResponse = {
  ok?: boolean;
  results?: Record<string, { ok?: boolean; posted?: number; error?: string; details?: unknown }>;
  error?: string;
  status?: number;
  body?: string;
  jobId?: string;
  jobStatus?: string;
};


const PROVIDER_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook Pages',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  threads: 'Threads',
};

const PUBLISH_SUPPORTED: Record<string, boolean> = {
  facebook: true,
  instagram: true,
  tiktok: true,
  youtube: true,
  pinterest: true,
  threads: false,
};

export const ContentPosts: React.FC = () => {
  const { connectedProviders, facebookPages } = useIntegrations();
	const [caption, setCaption] = useState<string>('');
	const [media, setMedia] = useState<MediaPreview[]>([]);
	const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<PublishResponse | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectAll, setSelectAll] = useState(true);
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});
  const [fbSelected, setFbSelected] = useState<Record<string, boolean>>({});
  const [fbExpanded, setFbExpanded] = useState(true);
  const didInit = useRef(false);
  const facebookProviderRef = useRef<HTMLInputElement | null>(null);

  // Allow linking into the publisher with a pre-filled caption (used by the new local Library page).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('caption');
    if (c && caption.trim() === '') setCaption(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postableFacebookPages = useMemo(() => facebookPages.filter((p) => p.canPost), [facebookPages]);
  const postableFacebookPageIds = useMemo(() => postableFacebookPages.map((p) => p.id), [postableFacebookPages]);

  const selectedFacebookPageIds = useMemo(() => {
    return postableFacebookPageIds.filter((id) => !!fbSelected[id]);
  }, [fbSelected, postableFacebookPageIds]);

  const fbSelectedCount = selectedFacebookPageIds.length;
  const fbTotalCount = postableFacebookPageIds.length;
  const fbAllSelected = fbTotalCount > 0 && fbSelectedCount === fbTotalCount;
  const fbSomeSelected = fbSelectedCount > 0 && !fbAllSelected;

  useEffect(() => {
    // Initialize selections once when we first have connected providers/pages.
    if (didInit.current) return;
    if (connectedProviders.length === 0) return;
    didInit.current = true;

    const next: Record<string, boolean> = {};
    for (const p of connectedProviders) next[p] = true;
    setSelected(next);
    setSelectAll(true);

    if (connectedProviders.includes('facebook')) {
      const fbNext: Record<string, boolean> = {};
      for (const p of facebookPages) {
        if (p.canPost) fbNext[p.id] = true;
      }
      setFbSelected(fbNext);
    }
  }, [connectedProviders, facebookPages]);

  // Keep Facebook provider checkbox in sync with page selection state (tri-state via indeterminate).
  useEffect(() => {
    const el = facebookProviderRef.current;
    if (!el) return;
    el.indeterminate = !!selected.facebook && fbSomeSelected;
  }, [fbSomeSelected, selected.facebook]);

  // If Facebook is selected but pages arrive later, default-select all postable pages once.
  useEffect(() => {
    if (!selected.facebook) return;
    if (fbTotalCount === 0) return;
    if (Object.keys(fbSelected).length > 0) return;
    const next: Record<string, boolean> = {};
    for (const id of postableFacebookPageIds) next[id] = true;
    setFbSelected(next);
  }, [selected.facebook, fbTotalCount, fbSelected, postableFacebookPageIds]);

  const selectedProviders = useMemo(() => {
    // Only include providers that the backend currently supports for publishing.
    return Object.keys(selected).filter((k) => selected[k] && PUBLISH_SUPPORTED[k] === true);
  }, [selected]);

  useEffect(() => {
    // Keep "select all" in sync when user toggles individuals
    if (connectedProviders.length === 0) return;
    const allOn = connectedProviders.every((p) => selected[p]);
    setSelectAll(allOn);
  }, [connectedProviders, selected]);

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
    setJobId(null);
    if (!caption.trim()) {
      setStatus('Please write a caption.');
      return;
    }
    if (selectedProviders.length === 0) {
      setStatus('Select at least one connected network.');
      return;
    }
    if (selectedProviders.includes('instagram') && media.length === 0) {
      setStatus('Instagram publishing requires at least one image.');
      return;
    }
    if (selectedProviders.includes('tiktok')) {
      const hasVideo = media.some((m) => (m.file?.type || '').startsWith('video/'));
      if (!hasVideo) {
        setStatus('TikTok publishing requires a video file (mp4/mov/webm).');
        return;
      }
    }
    if (selectedProviders.includes('youtube')) {
      const hasVideo = media.some((m) => (m.file?.type || '').startsWith('video/'));
      if (!hasVideo) {
        setStatus('YouTube publishing requires a video file.');
        return;
      }
    }
    if (selectedProviders.includes('pinterest')) {
      const hasImage = media.some((m) => (m.file?.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(m.file?.name || ''));
      if (!hasImage) {
        setStatus('Pinterest publishing requires an image file.');
        return;
      }
    }
    setIsSubmitting(true);
		setStatus(`Publishing to ${selectedProviders.length} network(s)...`);
    try {
      const facebookPageIds = selectedProviders.includes('facebook')
        ? Object.keys(fbSelected).filter((id) => fbSelected[id])
        : [];
      const hasMedia = media.length > 0;
      const body = hasMedia ? (() => {
        const fd = new FormData();
        fd.append('caption', caption);
        fd.append('providers', JSON.stringify(selectedProviders));
        fd.append('facebookPageIds', JSON.stringify(facebookPageIds));
        for (const m of media) {
          fd.append('media', m.file, m.file.name);
        }
        return fd;
      })() : JSON.stringify({ caption, providers: selectedProviders, facebookPageIds });

      const res = await fetch('/api/posts/publish', {
        method: 'POST',
        // IMPORTANT: don't set Content-Type for FormData; browser will set boundary.
        headers: hasMedia ? undefined : { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
      });
      const data: PublishResponse = await res.json().catch(() => ({}));
      // Async path: we get back a jobId quickly. Then subscribe over WS for progress + final result.
      if (data?.jobId) {
        setJobId(data.jobId);
        setStatus(`Publishing in background (job ${data.jobId})...`);
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${proto}://${window.location.host}/api/posts/publish/ws?jobId=${encodeURIComponent(data.jobId)}`;
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string);
            const job = msg?.job;
            const st = typeof job?.status === 'string' ? job.status : null;
            if (st) setStatus(`Publish job ${st}...`);

            // Backend job status response includes `result` (JSON) when finished.
            const result = job?.result;
            if (result && typeof result === 'object' && (result as any).results) {
              setResults(result as PublishResponse);
              const rmap = (result as any).results;
              const anyFail = rmap && typeof rmap === 'object' && Object.values(rmap).some((r: any) => !r?.ok);
              if (st === 'failed' || anyFail) setStatus('Publish completed with errors. Expand Results for details.');
              if (st === 'completed' && !anyFail) setStatus('Publish completed successfully.');
            }
          } catch { void 0; }
        };
        ws.onerror = () => setStatus('Publish started, but realtime updates failed (websocket error).');
        // don't block: request already enqueued
        return;
      }

      // Sync fallback (legacy)
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

  const setFacebookSelectedAll = (checked: boolean) => {
    setSelected((prev) => ({ ...prev, facebook: checked }));
    if (!checked) {
      setFbSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const id of postableFacebookPageIds) next[id] = true;
    setFbSelected(next);
    setFbExpanded(true);
  };

  const toggleFacebookPage = (pageId: string, checked: boolean) => {
    setFbSelected((prev) => {
      const next = { ...prev };
      if (checked) next[pageId] = true;
      else delete next[pageId];

      // Maintain provider checkbox state: checked if any page is selected.
      const anySelected = postableFacebookPageIds.some((id) => !!next[id]);
      setSelected((prevSel) => ({ ...prevSel, facebook: anySelected }));
      return next;
    });
  };

	return (
		<Layout headerPaddingClass="pt-24">
			<div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-8">
				<header className="space-y-2">
					<h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Publish Post</h1>
					<p className="text-slate-600 dark:text-slate-400 text-sm">
            Choose which connected networks to publish to.
					</p>
				</header>
				<div className="bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Left sidebar: networks selection */}
            <aside className="xl:col-span-4 space-y-6 xl:sticky xl:top-28 self-start">
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
                    for (const p of connectedProviders) {
                      // Only allow selecting publish-supported providers when toggling "all"
                      next[p] = v && PUBLISH_SUPPORTED[p] === true;
                    }
                    setSelected(next);
                    if (connectedProviders.includes('facebook')) {
                      // When selecting all providers, also select all postable Facebook pages.
                      if (v) {
                        const fbNext: Record<string, boolean> = {};
                        for (const id of postableFacebookPageIds) fbNext[id] = true;
                        setFbSelected(fbNext);
                      } else {
                        setFbSelected({});
                      }
                    }
                  }}
                />
                Post to all connected
              </label>
            </div>
            {connectedProviders.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-300">
                No connected networks yet. Go to <a href="/integrations" className="underline">Integrations</a> to connect.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
                {connectedProviders.map((p) => (
                  p === 'facebook' ? (
                    <label key={p} className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                      <input
                        ref={facebookProviderRef}
                        type="checkbox"
                        checked={!!selected.facebook && (fbAllSelected || fbSomeSelected || fbTotalCount === 0)}
                        onChange={(e) => setFacebookSelectedAll(e.target.checked)}
                      />
                      <span className="text-slate-800 dark:text-slate-100">{PROVIDER_LABELS[p] || p}</span>
                      {fbTotalCount > 0 && (
                        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                          {fbSelectedCount}/{fbTotalCount}
                        </span>
                      )}
                    </label>
                  ) : (
                    <label
                      key={p}
                      className={`flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm ${
                        PUBLISH_SUPPORTED[p] !== true ? 'opacity-60' : ''
                      }`}
                      title={PUBLISH_SUPPORTED[p] === true ? '' : 'Publishing not supported yet'}
                    >
                      <input
                        type="checkbox"
                        disabled={PUBLISH_SUPPORTED[p] !== true}
                        checked={!!selected[p] && PUBLISH_SUPPORTED[p] === true}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [p]: e.target.checked }))}
                      />
                      <span className="text-slate-800 dark:text-slate-100">{PROVIDER_LABELS[p] || p}</span>
                      {PUBLISH_SUPPORTED[p] !== true && (
                        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">coming soon</span>
                      )}
                    </label>
                  )
                ))}
              </div>
            )}

            {connectedProviders.includes('facebook') && selected.facebook && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white/60 dark:bg-slate-900/20">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Facebook Pages</div>
                  <button
                    type="button"
                    className="text-xs underline text-slate-600 dark:text-slate-300"
                    onClick={() => setFbExpanded((v) => !v)}
                  >
                    {fbExpanded ? 'Hide pages' : 'Choose pages'}
                  </button>
                </div>
                {fbExpanded && (
                  <div className="mt-3 space-y-2">
                    {facebookPages.length === 0 ? (
                      <div className="text-sm text-slate-500 dark:text-slate-300">
                        No pages found (or you need to reconnect Facebook so we can read your page list/tasks).
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {facebookPages.map((pg) => {
                          const disabled = !pg.canPost;
                          return (
                            <label
                              key={pg.id}
                              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                                disabled
                                  ? 'border-slate-200 dark:border-slate-700 opacity-60'
                                  : 'border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                disabled={disabled}
                                checked={!!fbSelected[pg.id]}
                                onChange={(e) => toggleFacebookPage(pg.id, e.target.checked)}
                              />
                              <div className="min-w-0">
                                <div className="text-slate-800 dark:text-slate-100 truncate">
                                  {pg.name || pg.id}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {disabled ? 'Not postable with your current role' : 'Will post to this page'}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Tip: if everything is disabled, reconnect Facebook and ensure your user has Page permissions that include creating content.
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Note: publishing support is incremental. Currently the backend supports caption-only publishing for Facebook Pages; other networks may report <span className="font-mono">not_supported_yet</span>.
            </p>
              </div>
            </aside>

            {/* Main: post content */}
            <section className="xl:col-span-8 space-y-6">
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
						<input type="file" accept="image/*,video/*" multiple onChange={(e) => onFiles(e.target.files)} />
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
						<button onClick={submit} className="btn btn-primary" disabled={isSubmitting || connectedProviders.length === 0}>
              {isSubmitting ? 'Publishing…' : 'Publish'}
            </button>
						{status && <span className="text-sm text-slate-500 dark:text-slate-300">{status}</span>}
            {jobId && <span className="text-xs text-slate-400 dark:text-slate-400">job: {jobId}</span>}
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
            </section>
          </div>
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
