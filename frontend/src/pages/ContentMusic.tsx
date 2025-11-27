import React, { useState } from 'react';
import { Layout } from '../components/Layout';

export const ContentMusic: React.FC = () => {
	const [prompt, setPrompt] = useState<string>('Energetic pop track for social video');
	const [status, setStatus] = useState<string | null>(null);
	const [filePath, setFilePath] = useState<string | null>(null);
    const [model, setModel] = useState<string>('V4');

	const generate = async () => {
		setStatus('Generating with Suno...');
		setFilePath(null);
		try {
			const res = await fetch(`/api/integrations/suno/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ prompt, model }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data?.ok) {
				const detail = data?.details ? ` (${String(data.details).slice(0,200)})` : '';
				const status = data?.status ? ` [${data.status}]` : '';
				setStatus(`Suno failed: ${data?.error || res.statusText}${status}${detail}`);
				return;
			}
			setStatus('Track created and stored.');
			if (data?.stored?.filePath) {
				setFilePath(data.stored.filePath);
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setStatus(`Suno failed: ${msg}`);
		}
	};

	return (
		<Layout headerPaddingClass="pt-24">
			<div className="max-w-4xl mx-auto space-y-8">
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
			</div>
		</Layout>
	);
};
