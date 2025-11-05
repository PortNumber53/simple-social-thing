import React, { useState } from 'react';
import { Layout } from '../components/Layout';

interface MediaPreview {
	id: string;
	file: File;
	url: string;
}

export const ContentPosts: React.FC = () => {
	const [caption, setCaption] = useState<string>('');
	const [media, setMedia] = useState<MediaPreview[]>([]);
	const [status, setStatus] = useState<string | null>(null);

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
		setStatus('Posting to Instagram (placeholder)...');
		// In a real flow we would send FormData to backend which would talk to IG Graph API
		setTimeout(() => {
			setStatus('Post queued.');
		}, 900);
	};

	return (
		<Layout headerPaddingClass="pt-24">
			<div className="max-w-5xl mx-auto space-y-8">
				<header className="space-y-2">
					<h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Instagram Posts</h1>
					<p className="text-slate-600 dark:text-slate-400 text-sm">Create single or multi-image posts.</p>
				</header>
				<div className="bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-6 space-y-6">
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
						<button onClick={submit} className="btn btn-primary">Publish</button>
						{status && <span className="text-sm text-slate-500 dark:text-slate-300">{status}</span>}
					</div>
				</div>
			</div>
		</Layout>
	);
};
