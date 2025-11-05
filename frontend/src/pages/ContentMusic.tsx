import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';

export const ContentMusic: React.FC = () => {
	const [prompt, setPrompt] = useState<string>('Energetic pop track for social video');
	const [status, setStatus] = useState<string | null>(null);
	const [filePath, setFilePath] = useState<string | null>(null);
	const [apiKey, setApiKey] = useState<string>('');

	useEffect(() => {
		const loadKey = async () => {
			try {
				const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
				const workerOrigin = (isLocalhost && import.meta.env.VITE_WORKER_ORIGIN)
					? import.meta.env.VITE_WORKER_ORIGIN
					: window.location.origin;
				const res = await fetch(`${workerOrigin}/api/integrations/suno/api-key`);
				const data = await res.json();
				if (data?.ok && data?.value?.apiKey) {
					setApiKey(data.value.apiKey);
				}
			} catch {}
		};
		loadKey();
	}, []);

	const saveKey = async () => {
		setStatus('Saving key...');
		try {
			const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
			const workerOrigin = (isLocalhost && import.meta.env.VITE_WORKER_ORIGIN)
				? import.meta.env.VITE_WORKER_ORIGIN
				: window.location.origin;
			const res = await fetch(`${workerOrigin}/api/integrations/suno/api-key`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiKey }),
			});
			if (!res.ok) {
				setStatus('Failed to save key');
				return;
			}
			setStatus('Key saved');
		} catch (e: any) {
			setStatus(`Failed to save key: ${e?.message || e}`);
		}
	};

	const generate = async () => {
		setStatus('Generating with Suno...');
		setFilePath(null);
		try {
			const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
			const workerOrigin = (isLocalhost && import.meta.env.VITE_WORKER_ORIGIN)
				? import.meta.env.VITE_WORKER_ORIGIN
				: window.location.origin;
			const res = await fetch(`${workerOrigin}/api/integrations/suno/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt }),
			});
			const data = await res.json();
			if (!res.ok || !data?.ok) {
				setStatus(`Suno failed: ${data?.error || res.statusText}`);
				return;
			}
			setStatus('Track created and stored.');
			if (data?.stored?.filePath) {
				setFilePath(data.stored.filePath);
			}
		} catch (e: any) {
			setStatus(`Suno failed: ${e?.message || e}`);
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
					<div className="space-y-2">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-200">Suno API key</label>
						<div className="flex gap-3 items-center">
							<input
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
								placeholder="sk-..."
							/>
							<button onClick={saveKey} className="btn btn-primary">Save</button>
						</div>
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
