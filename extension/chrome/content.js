const PROVIDER_MAP = [
  { hostIncludes: 'instagram.com', provider: 'instagram' },
  { hostIncludes: 'facebook.com', provider: 'facebook' },
  { hostIncludes: 'tiktok.com', provider: 'tiktok' },
  { hostIncludes: 'pinterest.com', provider: 'pinterest' },
  { hostIncludes: 'youtube.com', provider: 'youtube' },
  { hostIncludes: 'threads.net', provider: 'threads' },
  { hostIncludes: 'threads.com', provider: 'threads' },
  { hostIncludes: 'x.com', provider: 'twitter' },
  { hostIncludes: 'twitter.com', provider: 'twitter' }
];

function detectProvider(url) {
  const host = new URL(url).host;
  for (const entry of PROVIDER_MAP) {
    if (host.includes(entry.hostIncludes)) return entry.provider;
  }
  return 'unknown';
}

function collectMedia() {
  const media = [];
  document.querySelectorAll('video[src], video source[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) media.push({ type: 'video', src });
  });
  document.querySelectorAll('img[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) media.push({ type: 'image', src });
  });
  return media;
}

function collectMeta() {
  const getMeta = (name) => {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? el.getAttribute('content') || '' : '';
  };
  return {
    title: document.title || '',
    description: getMeta('og:description') || getMeta('description'),
    image: getMeta('og:image'),
    video: getMeta('og:video') || getMeta('og:video:url') || getMeta('og:video:secure_url')
  };
}

function collectSelection() {
  const sel = window.getSelection();
  return sel ? sel.toString() : '';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'getPageData') {
    const url = window.location.href;
    const provider = detectProvider(url);
    const meta = collectMeta();
    const media = collectMedia();
    const selection = collectSelection();
    sendResponse({
      url,
      provider,
      meta,
      media,
      selection,
      timestamp: Date.now()
    });
    return true;
  }
  return false;
});

