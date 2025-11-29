import React, { useState } from 'react';
import { Layout } from '../components/Layout';

export const ContentVideos: React.FC = () => {
	const [caption, setCaption] = useState<string>('');
	const [video, setVideo] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	const onFile = (fileList: FileList | null) => {
		if (!fileList || fileList.length === 0) return;
		const file = fileList[0];
		setVideo(file);
		setPreviewUrl(URL.createObjectURL(file));
	};

	const submit = async () => {
		setStatus('Uploading video to Instagram (placeholder)...');
		setTimeout(() => {
			setStatus('Video queued.');
		}, 900);
	};

	return (
		<Layout headerPaddingClass="pt-24">
			<div className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-none mx-auto space-y-8">
				<header className="space-y-2">
					<h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Instagram Videos</h1>
					<p className="text-slate-600 dark:text-slate-400 text-sm">Upload a single video for Reels/Instagram.</p>
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
					<div className="space-y-2">
						<label className="text-sm font-medium text-slate-700 dark:text-slate-200">Video</label>
						<input type="file" accept="video/*" onChange={(e) => onFile(e.target.files)} />
						{previewUrl && (
							<video src={previewUrl} controls className="mt-2 w-full max-h-64 rounded-lg" />
						)}
					</div>
					<div className="flex gap-3 items-center">
						<button onClick={submit} className="btn btn-primary" disabled={!video}>Publish</button>
						{status && <span className="text-sm text-slate-500 dark:text-slate-300">{status}</span>}
					</div>
				</div>
			</div>
		</Layout>
	);
};
