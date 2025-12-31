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
  // Videos
  document.querySelectorAll('video, video source').forEach((el) => {
    const src = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src');
    if (src) media.push({ type: 'video', src });
  });
  // Images (cover lazy-load attributes)
  document.querySelectorAll('img').forEach((el) => {
    const src = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original');
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

let latest = {
  url: '',
  provider: 'unknown',
  meta: {},
  media: [],
  selection: '',
  timestamp: Date.now()
};

function refreshPageData() {
  const url = window.location.href;
  const provider = detectProvider(url);
  const meta = collectMeta();
  const mediaRaw = collectMedia();
  const mediaDeduped = [];
  const seen = new Set();
  mediaRaw.forEach((m) => {
    const key = `${m.type}:${m.src}`;
    if (!seen.has(key)) {
      seen.add(key);
      mediaDeduped.push(m);
    }
  });
  latest = {
    url,
    provider,
    meta,
    media: mediaDeduped,
    selection: collectSelection(),
    timestamp: Date.now()
  };
}

// Observe DOM mutations to catch lazy-loaded media (e.g., videos that acquire src later).
let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshPageData();
  }, 150);
}

if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'data-original']
  });
}

// Watch SPA URL changes.
let lastHref = window.location.href;
setInterval(() => {
  const href = window.location.href;
  if (href !== lastHref) {
    lastHref = href;
    refreshPageData();
  }
}, 1000);

// Initial capture.
refreshPageData();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'getPageData') {
    refreshPageData();
    sendResponse(latest);
    return true;
  }
  return false;
});

