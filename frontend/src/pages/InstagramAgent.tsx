import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

type Tool = 'post' | 'caption' | 'hashtags' | 'strategy' | 'chat';

type Account = {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
};

type InsightResponse = {
  scope: 'account' | 'media';
  period?: string;
  mediaId?: string;
  metrics: Record<string, unknown>;
};

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'post', label: 'Post' },
  { id: 'caption', label: 'Caption' },
  { id: 'hashtags', label: 'Hashtags' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'chat', label: 'Ask' },
];

const inputLabels: Record<Tool, string> = {
  post: 'What should the post be about?',
  caption: 'Describe the image',
  hashtags: 'Describe the content',
  strategy: 'Instagram niche',
  chat: 'Ask your Instagram question',
};

function errorMessage(value: unknown): string {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string') return obj.message;
  }
  return 'Request failed';
}

export const InstagramAgent: React.FC = () => {
  const [tool, setTool] = useState<Tool>('post');
  const [input, setInput] = useState('');
  const [style, setStyle] = useState('professional');
  const [tone, setTone] = useState('engaging');
  const [goals, setGoals] = useState('growth');
  const [count, setCount] = useState(15);
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeRationale, setIncludeRationale] = useState(false);
  const [stream, setStream] = useState(true);
  const [content, setContent] = useState('');
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [account, setAccount] = useState<Account | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [period, setPeriod] = useState('day');
  const [mediaId, setMediaId] = useState('');
  const [insights, setInsights] = useState<InsightResponse | null>(null);
  const [insightStatus, setInsightStatus] = useState<string | null>(null);

  const [imagePrompt, setImagePrompt] = useState('');
  const [imageSeed, setImageSeed] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);

  const composerUrl = useMemo(() => `/content/posts?caption=${encodeURIComponent(content.trim())}`, [content]);

  const loadAccount = async () => {
    setLoadingAccount(true);
    setAccountStatus(null);
    const res = await apiJson<Account>('/api/instagram-agent/account');
    if (res.ok) setAccount(res.data);
    else {
      setAccount(null);
      setAccountStatus(res.error.message === 'instagram_not_connected' ? 'Connect Instagram first on the Integrations page.' : res.error.message);
    }
    setLoadingAccount(false);
  };

  useEffect(() => {
    void loadAccount();
  }, []);

  const generate = async () => {
    if (!input.trim()) {
      setGenerationStatus('Enter a topic or description first.');
      return;
    }
    setGenerating(true);
    setContent('');
    setGenerationStatus(stream ? 'Generating and streaming…' : 'Generating…');
    const body = {
      type: tool,
      input: input.trim(),
      style,
      tone,
      goals,
      count,
      includeHashtags,
      includeRationale,
      stream,
    };

    try {
      if (!stream) {
        const res = await apiJson<{ content: string }>('/api/instagram-agent/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(res.error.message);
        setContent(res.data.content || '');
        setGenerationStatus('Generated.');
        return;
      }

      const res = await fetch('/api/instagram-agent/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data));
      }
      if (!res.body) throw new Error('Streaming is not available in this browser.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let result = '';
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const token = event.choices?.[0]?.delta?.content || '';
            if (token) {
              result += token;
              setContent(result);
            }
          } catch { /* ignore provider keepalive/non-JSON events */ }
        }
        if (done) break;
      }
      setGenerationStatus(result ? 'Generated.' : 'The model returned no text.');
    } catch (err) {
      setGenerationStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const loadInsights = async () => {
    setInsightStatus('Loading insights…');
    setInsights(null);
    const query = mediaId.trim()
      ? `?mediaId=${encodeURIComponent(mediaId.trim())}`
      : `?period=${encodeURIComponent(period)}`;
    const res = await apiJson<InsightResponse>(`/api/instagram-agent/insights${query}`);
    if (res.ok) {
      setInsights(res.data);
      setInsightStatus(null);
    } else setInsightStatus(res.error.message);
  };

  const refreshToken = async () => {
    setAccountStatus('Refreshing token…');
    const res = await apiJson<{ expiresAt?: string }>('/api/instagram-agent/refresh-token', { method: 'POST' });
    if (res.ok) setAccountStatus(res.data.expiresAt ? `Token refreshed through ${new Date(res.data.expiresAt).toLocaleDateString()}.` : 'Token refreshed.');
    else setAccountStatus(res.error.message);
  };

  const generateImage = async () => {
    if (!imagePrompt.trim()) {
      setImageStatus('Enter an image prompt first.');
      return;
    }
    setGeneratingImage(true);
    setImageStatus('Generating image…');
    setImageUrl(null);
    const seed = imageSeed.trim() === '' ? undefined : Number(imageSeed);
    const res = await apiJson<{ data?: Array<{ url?: string; b64_json?: string }> }>('/api/instagram-agent/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: imagePrompt.trim(), seed, steps: 4, height: 1024, width: 1024, guidance: 4 }),
    });
    if (res.ok) {
      const image = res.data.data?.[0];
      const nextUrl = image?.url || (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : null);
      setImageUrl(nextUrl);
      setImageStatus(nextUrl ? 'Image generated.' : 'The image provider returned no image.');
    } else setImageStatus(res.error.message);
    setGeneratingImage(false);
  };

  return (
    <div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Instagram Agent</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Generate content and images, review account analytics, and send finished copy to the composer.</p>
      </header>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Content studio</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Uses the server-configured OpenAI-compatible model.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Content type">
            {TOOLS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tool === item.id} onClick={() => setTool(item.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${tool === item.id ? 'bg-primary-600 text-white border-primary-600' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
                {item.label}
              </button>
            ))}
          </div>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{inputLabels[tool]}</span>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={5}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tool === 'post' && <label className="text-sm">Style<input value={style} onChange={(e) => setStyle(e.target.value)} className="mt-1 w-full form-input rounded-md border-slate-200 dark:border-slate-700 dark:bg-slate-900" /></label>}
            {tool === 'caption' && <label className="text-sm">Tone<input value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full form-input rounded-md border-slate-200 dark:border-slate-700 dark:bg-slate-900" /></label>}
            {tool === 'strategy' && <label className="text-sm">Goal<input value={goals} onChange={(e) => setGoals(e.target.value)} className="mt-1 w-full form-input rounded-md border-slate-200 dark:border-slate-700 dark:bg-slate-900" /></label>}
            {tool === 'hashtags' && <label className="text-sm">Count<input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1 w-full form-input rounded-md border-slate-200 dark:border-slate-700 dark:bg-slate-900" /></label>}
            {tool === 'post' && <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={includeHashtags} onChange={(e) => setIncludeHashtags(e.target.checked)} /> Include hashtags</label>}
            <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} /> Stream output</label>
            <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={includeRationale} onChange={(e) => setIncludeRationale(e.target.checked)} /> Explain choices</label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" onClick={generate} disabled={generating}>{generating ? 'Generating…' : 'Generate'}</button>
            {generationStatus && <span className="text-sm text-slate-500 dark:text-slate-400">{generationStatus}</span>}
          </div>
          {content && (
            <div className="space-y-3">
              <textarea aria-label="Generated content" value={content} onChange={(e) => setContent(e.target.value)} rows={10}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-3 text-sm" />
              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(content)}>Copy</button>
                <Link className="btn btn-primary" to={composerUrl}>Use in composer</Link>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <section className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Instagram account</h2>
              <button type="button" className="text-sm text-primary-600" onClick={loadAccount} disabled={loadingAccount}>Refresh</button>
            </div>
            {account ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  {account.profile_picture_url && <img src={account.profile_picture_url} alt="" className="w-12 h-12 rounded-full" />}
                  <div><div className="font-medium">@{account.username || 'unknown'}</div><div className="text-slate-500">{account.name}</div></div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Metric label="Followers" value={account.followers_count} />
                  <Metric label="Following" value={account.follows_count} />
                  <Metric label="Posts" value={account.media_count} />
                </div>
                <button type="button" className="btn btn-secondary w-full" onClick={refreshToken}>Refresh access token</button>
              </div>
            ) : !loadingAccount && <Link to="/integrations" className="text-sm text-primary-600">Connect Instagram</Link>}
            {accountStatus && <p className="text-xs text-slate-500 dark:text-slate-400">{accountStatus}</p>}
          </section>

          <section className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Insights</h2>
            <label className="block text-sm">Media ID (optional)<input value={mediaId} onChange={(e) => setMediaId(e.target.value)} placeholder="Leave blank for account insights" className="mt-1 w-full form-input rounded-md border-slate-200 dark:border-slate-700 dark:bg-slate-900" /></label>
            {!mediaId.trim() && <label className="block text-sm">Period<select value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 w-full form-select rounded-md border-slate-200 dark:border-slate-700 dark:bg-slate-900"><option value="day">Day</option><option value="week">Week</option><option value="days_28">28 days</option></select></label>}
            <button type="button" className="btn btn-secondary w-full" onClick={loadInsights}>Load insights</button>
            {insightStatus && <p className="text-xs text-slate-500">{insightStatus}</p>}
            {insights && <div className="grid grid-cols-2 gap-2">{Object.entries(insights.metrics).map(([name, value]) => <Metric key={name} label={name.replaceAll('_', ' ')} value={value} />)}</div>}
          </section>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <div><h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Image generator</h2><p className="text-sm text-slate-500">Generate a publish-ready square image through the configured FLUX/MFlux-compatible endpoint.</p></div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_12rem] gap-3">
          <textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} rows={3} placeholder="Describe the image…" aria-label="Image prompt" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm" />
          <input value={imageSeed} onChange={(e) => setImageSeed(e.target.value)} inputMode="numeric" placeholder="Optional seed" aria-label="Image seed" className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 px-3 text-sm" />
        </div>
        <div className="flex items-center gap-3"><button type="button" className="btn btn-primary" onClick={generateImage} disabled={generatingImage}>{generatingImage ? 'Generating…' : 'Generate image'}</button>{imageStatus && <span className="text-sm text-slate-500">{imageStatus}</span>}</div>
        {imageUrl && <img src={imageUrl} alt={imagePrompt} className="w-full max-w-xl aspect-square rounded-xl object-cover border border-slate-200 dark:border-slate-700" />}
      </section>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 p-2">
    <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{value == null ? '—' : String(value)}</div>
    <div className="text-[11px] capitalize text-slate-500 dark:text-slate-400">{label}</div>
  </div>
);
