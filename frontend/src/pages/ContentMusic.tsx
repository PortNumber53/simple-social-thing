import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { apiJson } from '../lib/api';
import { safeStorage } from '../lib/safeStorage';
import { usePolling } from '../lib/usePolling';

type SunoTrack = {
	id: string;
	prompt?: string | null;
	taskId?: string | null;
	model?: string | null;
	sunoTrackId?: string | null;
	audioUrl?: string | null;
	filePath?: string | null;
	status?: string | null;
	createdAt?: string;
	updatedAt?: string | null;
};

export const ContentMusic: React.FC = () => {
	const [prompt, setPrompt] = useState<string>('Energetic pop track for social video');
	const [status, setStatus] = useState<string | null>(null);
	const [filePath, setFilePath] = useState<string | null>(null);
    const [model, setModel] = useState<string>('V4');
	const [tracks, setTracks] = useState<SunoTrack[]>([]);
	const [tracksLoading, setTracksLoading] = useState<boolean>(false);
	const [creditsLoading, setCreditsLoading] = useState<boolean>(false);
	const [creditsText, setCreditsText] = useState<string | null>(null);
	const [syncLoading, setSyncLoading] = useState<boolean>(false);
	const [syncText, setSyncText] = useState<string | null>(null);
	const [cachedCredits, setCachedCredits] = useState<number | null>(() => {
    const st = safeStorage();
    const parsed = st.getJSON<any>('user_settings');
    const sc = parsed?.suno_credits;
    if (typeof sc === 'number') return sc;
    if (sc && typeof sc === 'object') {
      if (typeof sc.availableCredits === 'number') return sc.availableCredits;
      if (typeof sc.available === 'number') return sc.available;
    }
    return null;
	});

	const hasPending = useMemo(() => tracks.some((t) => (t.status || '').toLowerCase() === 'pending'), [tracks]);

	const loadTracks = useCallback(async () => {
		setTracksLoading(true);
		try {
      const res = await apiJson<unknown>(`/api/integrations/suno/tracks`);
      const data: unknown = res.ok ? res.data : null;
      if (Array.isArray(data)) setTracks(data as SunoTrack[]);
		} finally {
			setTracksLoading(false);
		}
	}, []);

	const checkCredits = async () => {
		setCreditsLoading(true);
		setCreditsText(null);
		try {
			const res = await apiJson<any>(`/api/integrations/suno/credits`);
			const data: unknown = res.ok ? res.data : res.data;
			if (!res.ok) {
				const err = data && typeof data === 'object' && 'error' in data ? String((data as { error?: unknown }).error) : res.error.message;
				setCreditsText(`Failed to fetch credits: ${err}`);
				return;
			}
			// Worker returns: { ok: true, credits: { code, msg, data }, availableCredits?: number|null }
			const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
			const creditsContainer = obj && obj.credits && typeof obj.credits === 'object' ? (obj.credits as Record<string, unknown>) : null;
			const availableCredits = obj && typeof obj.availableCredits !== 'undefined' ? obj.availableCredits : null;
			const code = creditsContainer && typeof creditsContainer.code !== 'undefined' ? String(creditsContainer.code) : '';
			const msg = creditsContainer && typeof creditsContainer.msg === 'string' ? creditsContainer.msg : '';
			const innerData = creditsContainer ? creditsContainer.data : null;

			let balancePart = '';
			if (typeof availableCredits === 'number') {
				balancePart = `available=${availableCredits}`;
				setCachedCredits(availableCredits);
				// Update browser cache (best effort) so initial renders can use it.
        const st = safeStorage();
        const prev = st.getJSON<any>('user_settings') || {};
        prev.suno_credits = { ...(prev.suno_credits || {}), availableCredits, fetchedAt: new Date().toISOString() };
        st.setJSON('user_settings', prev);
			} else if (typeof availableCredits === 'string' && availableCredits.trim() !== '') {
				balancePart = `available=${availableCredits}`;
			}

			let rawPart = '';
			if (!balancePart && innerData && typeof innerData === 'object') {
				try {
					rawPart = `data=${JSON.stringify(innerData).slice(0, 220)}`;
				} catch { void 0; }
			}

			setCreditsText(`Suno credits: ${[balancePart, rawPart, msg ? `msg=${msg}` : '', code ? `code=${code}` : ''].filter(Boolean).join(' ') || 'ok'}`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setCreditsText(`Failed to fetch credits: ${msg}`);
		} finally {
			setCreditsLoading(false);
		}
	};

	const syncFromSuno = async () => {
		setSyncLoading(true);
		setSyncText(null);
		try {
			const res = await apiJson<any>(`/api/integrations/suno/sync`, { method: 'POST' });
			const data: any = res.ok ? res.data : res.data;
			if (!res.ok || !data?.ok) {
				const err = data?.error ? String(data.error) : (res.ok ? 'unknown_error' : res.error.message);
				setSyncText(`Sync failed: ${err}`);
				return;
			}
			setSyncText(`Synced: checked ${data.checked}, updated ${data.updated}.`);
			void loadTracks();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setSyncText(`Sync failed: ${msg}`);
		} finally {
			setSyncLoading(false);
		}
	};

	useEffect(() => {
		void loadTracks();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

  usePolling({ enabled: hasPending, intervalMs: 5000, tick: loadTracks });

	const generate = async () => {
		setStatus('Generating with Suno...');
		setFilePath(null);
		try {
      const res = await apiJson<any>(`/api/integrations/suno/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      });
			const data: any = res.ok ? res.data : res.data;
			if (!res.ok || !data?.ok) {
				const detail = data?.details ? ` (${String(data.details).slice(0, 200)})` : '';
				const st = data?.status ? ` [${data.status}]` : '';
				const msg = data?.error ? String(data.error) : (res.ok ? 'unknown_error' : res.error.message);
				setStatus(`Suno failed: ${msg}${st}${detail}`);
				return;
			}
			const taskId = data?.suno?.taskId ? String(data.suno.taskId) : null;
			const audioUrl = data?.suno?.audioUrl ? String(data.suno.audioUrl) : null;
			if (audioUrl) {
				setStatus('Track generated.');
			} else if (taskId) {
				setStatus(`Generation started (task ${taskId}). It will appear in the table when complete.`);
			} else {
				setStatus('Generation started. It will appear in the table when complete.');
			}
			void loadTracks();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Suno failed: ${msg}`);
		}
	};

	return (
		<Layout headerPaddingClass="pt-24">
			<div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto space-y-8">
				<header className="space-y-2">
					<h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Music</h1>
					<p className="text-slate-600 dark:text-slate-400 text-sm">
						Create AI music via Suno; your key is stored per-user.
					</p>
				</header>
				<div className="space-y-6 bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-6">
					<div className="text-sm text-slate-600 dark:text-slate-400">
						Manage your Suno API key in <a className="underline hover:no-underline" href="/integrations">Integrations</a>.
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="space-y-2">
							<label className="text-sm font-medium text-slate-700 dark:text-slate-200">Model</label>
							<select
								value={model}
								onChange={(e) => setModel(e.target.value)}
								className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
							>
								<option value="V3_5">V3_5</option>
								<option value="V4">V4</option>
								<option value="V4_5">V4_5</option>
								<option value="V4_5PLUS">V4_5PLUS</option>
								<option value="V5">V5</option>
							</select>
						</div>
						<div className="space-y-2">
							<label className="text-sm font-medium text-slate-700 dark:text-slate-200">Prompt</label>
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								rows={3}
								className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
							/>
						</div>
					</div>
					<div className="flex gap-3 items-center">
						<button onClick={generate} className="btn btn-primary">Generate track</button>
						{status && <span className="text-sm text-slate-500 dark:text-slate-300">{status}</span>}
					</div>
					{filePath && (
						<p className="text-xs text-slate-500 break-all">Stored at: {filePath}</p>
					)}
				</div>

				<div className="bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-6">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Generated songs</h2>
							{typeof cachedCredits === 'number' && (
								<span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
									Credits: {cachedCredits}
								</span>
							)}
						</div>
						<div className="flex items-center gap-2">
							<button onClick={checkCredits} className="btn btn-secondary">
								{creditsLoading ? 'Checking…' : 'Check credits'}
							</button>
							<button onClick={syncFromSuno} className="btn btn-secondary">
								{syncLoading ? 'Syncing…' : 'Sync from Suno'}
							</button>
							<button onClick={loadTracks} className="btn btn-secondary">
								{tracksLoading ? 'Refreshing…' : 'Refresh'}
							</button>
						</div>
					</div>
					{(creditsText || syncText) && (
						<div className="mt-3 space-y-1">
							{creditsText && <p className="text-xs text-slate-600 dark:text-slate-300">{creditsText}</p>}
							{syncText && <p className="text-xs text-slate-600 dark:text-slate-300">{syncText}</p>}
						</div>
					)}
					<div className="mt-4 overflow-x-auto">
						<table className="min-w-full text-sm">
							<thead>
								<tr className="text-left text-slate-600 dark:text-slate-300 border-b border-slate-200/60 dark:border-slate-700/40">
									<th className="py-2 pr-4 font-medium">Created</th>
									<th className="py-2 pr-4 font-medium">Status</th>
									<th className="py-2 pr-4 font-medium">Model</th>
									<th className="py-2 pr-4 font-medium">Prompt</th>
									<th className="py-2 pr-0 font-medium">Audio</th>
								</tr>
							</thead>
							<tbody>
								{tracks.length === 0 ? (
									<tr>
										<td colSpan={5} className="py-6 text-slate-500 dark:text-slate-400">
											No songs yet. Generate one above and it will appear here once Suno completes.
										</td>
									</tr>
								) : (
									tracks.map((t) => {
										const created = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';
										const st = (t.status || '').toLowerCase();
										const badge =
											st === 'completed'
												? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
												: st === 'failed'
													? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
													: 'bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-200';
										return (
											<tr key={t.id} className="border-b border-slate-200/40 dark:border-slate-700/30">
												<td className="py-3 pr-4 whitespace-nowrap text-slate-700 dark:text-slate-200">{created}</td>
												<td className="py-3 pr-4">
													<span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${badge}`}>
														{t.status || 'pending'}
													</span>
												</td>
												<td className="py-3 pr-4 text-slate-700 dark:text-slate-200 whitespace-nowrap">{t.model || '-'}</td>
												<td className="py-3 pr-4 text-slate-700 dark:text-slate-200 max-w-[28rem] truncate" title={t.prompt || ''}>
													{t.prompt || ''}
												</td>
												<td className="py-3 pr-0">
													{t.audioUrl ? (
														<a className="underline hover:no-underline" href={t.audioUrl} target="_blank" rel="noreferrer">
															Open
														</a>
													) : (
														<span className="text-slate-500 dark:text-slate-400">—</span>
													)}
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
					{hasPending && (
						<p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
							Auto-refreshing while generation is pending…
						</p>
					)}
				</div>
			</div>
		</Layout>
	);
};
