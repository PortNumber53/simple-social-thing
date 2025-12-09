const qs = (sel) => document.querySelector(sel);
const apiBaseEl = qs('#apiBase');
const endpointEl = qs('#endpointPath');
const useCredsEl = qs('#useCredentials');
const saveBtn = qs('#saveConfig');
const sendBtn = qs('#sendToBackend');
const urlEl = qs('#currentUrl');
const providerEl = qs('#provider');
const mediaListEl = qs('#mediaList');
const selectionEl = qs('#selection');
const notesEl = qs('#notes');
const statusEl = qs('#status');

let pageData = null;

async function loadConfig() {
  const { apiBase = '', endpointPath = '/api/library/import', useCredentials = true } = await chrome.storage.sync.get([
    'apiBase',
    'endpointPath',
    'useCredentials'
  ]);
  apiBaseEl.value = apiBase;
  endpointEl.value = endpointPath;
  useCredsEl.checked = useCredentials;
}

async function saveConfig() {
  await chrome.storage.sync.set({
    apiBase: apiBaseEl.value.trim(),
    endpointPath: endpointEl.value.trim(),
    useCredentials: useCredsEl.checked
  });
  setStatus('Settings saved', 'ok');
}

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function fetchPageData() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  try {
    pageData = await chrome.tabs.sendMessage(tab.id, { type: 'getPageData' });
    if (!pageData) throw new Error('No data from content script');
    urlEl.textContent = pageData.url || '';
    providerEl.textContent = pageData.provider || 'unknown';
    selectionEl.textContent = pageData.selection || '';
    mediaListEl.innerHTML = '';
    if (pageData.media?.length) {
      pageData.media.forEach((m) => {
        const div = document.createElement('div');
        div.className = 'media-item';
        div.textContent = `${m.type}: ${m.src}`;
        mediaListEl.appendChild(div);
      });
    } else {
      mediaListEl.textContent = 'No media detected on this page.';
    }
  } catch (err) {
    setStatus(`Failed to read page: ${err.message}`, 'err');
  }
}

async function sendToBackend() {
  const apiBase = apiBaseEl.value.trim();
  const endpointPath = endpointEl.value.trim() || '/api/library/import';
  if (!apiBase) {
    setStatus('Please set API Base URL', 'err');
    return;
  }
  if (!pageData) {
    setStatus('No page data. Try reloading the panel.', 'err');
    return;
  }
  const body = {
    url: pageData.url,
    provider: pageData.provider,
    media: pageData.media || [],
    selection: pageData.selection || '',
    meta: pageData.meta || {},
    notes: notesEl.value || ''
  };
  try {
    setStatus('Sending...', '');
    const res = await fetch(`${apiBase.replace(/\/$/, '')}${endpointPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: useCredsEl.checked ? 'include' : 'omit',
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`status ${res.status}: ${text.slice(0, 200)}`);
    }
    setStatus('Queued successfully.', 'ok');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'err');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await fetchPageData();
});

saveBtn.addEventListener('click', saveConfig);
sendBtn.addEventListener('click', sendToBackend);

