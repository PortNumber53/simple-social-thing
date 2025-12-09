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
const selectAllEl = qs('#selectAllMedia');
const logEl = qs('#log');

let pageData = null;
let mediaSelections = [];

const truncate = (str, max = 90) => {
  if (!str) return '';
  if (str.length <= max) return str;
  return `${str.slice(0, Math.floor(max / 2) - 3)}...${str.slice(-Math.floor(max / 2))}`;
};

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    return true;
  } catch (err) {
    console.error('Failed to inject content script', err);
    return false;
  }
}

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

function setLog(msg) {
  if (!logEl) return;
  if (typeof msg === 'string') {
    logEl.textContent = msg;
    return;
  }
  try {
    logEl.textContent = JSON.stringify(msg, null, 2);
  } catch {
    logEl.textContent = String(msg);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderMediaList() {
  mediaListEl.innerHTML = '';
  if (!mediaSelections.length) {
    mediaListEl.textContent = 'No media detected on this page.';
    selectAllEl.checked = false;
    selectAllEl.indeterminate = false;
    return;
  }

  const allChecked = mediaSelections.every((m) => m.selected);
  const anyChecked = mediaSelections.some((m) => m.selected);
  selectAllEl.checked = allChecked;
  selectAllEl.indeterminate = !allChecked && anyChecked;

  mediaSelections.forEach((m) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'media-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = m.selected;
    cb.addEventListener('change', () => {
      m.selected = cb.checked;
      renderMediaList();
    });
    const text = document.createElement('div');
    text.innerHTML = `<strong>${m.type}</strong>: ${truncate(m.src)}`;
    wrapper.appendChild(cb);
    wrapper.appendChild(text);
    mediaListEl.appendChild(wrapper);
  });
}

async function fetchPageData() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  try {
    const url = tab.url || '';
    const supported = [
      'instagram.com',
      'facebook.com',
      'tiktok.com',
      'pinterest.com',
      'youtube.com',
      'threads.net',
      'threads.com',
      'x.com',
      'twitter.com'
    ].some((host) => url.includes(host));
    if (!supported) {
      throw new Error('Open a supported social page to collect media.');
    }

    const trySend = async () => chrome.tabs.sendMessage(tab.id, { type: 'getPageData' });

    pageData = await trySend().catch(async () => {
      // Attempt to inject the content script and retry once.
      const injected = await injectContentScript(tab.id);
      if (!injected) throw new Error('Could not inject content script on this page.');
      return trySend();
    });

    if (!pageData) throw new Error('No data from content script');
    mediaSelections = (pageData.media || []).map((m, idx) => ({
      ...m,
      id: idx,
      selected: true
    }));
    urlEl.textContent = pageData.url || '';
    providerEl.textContent = pageData.provider || 'unknown';
    selectionEl.textContent = pageData.selection || '';
    renderMediaList();
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
  const selectedMedia = mediaSelections.filter((m) => m.selected).map(({ type, src }) => ({ type, src }));
  if (!selectedMedia.length) {
    setStatus('Select at least one media item.', 'err');
    return;
  }
  if (!pageData) {
    setStatus('No page data. Try reloading the panel.', 'err');
    return;
  }
  const body = {
    url: pageData.url,
    provider: pageData.provider,
    media: selectedMedia,
    selection: pageData.selection || '',
    meta: pageData.meta || {},
    notes: notesEl.value || ''
  };
  try {
    setStatus('Sending...', '');
    setLog('');
    const res = await fetch(`${apiBase.replace(/\/$/, '')}${endpointPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: useCredsEl.checked ? 'include' : 'omit',
      body: JSON.stringify(body)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      setLog(text || `status ${res.status}`);
      const text = await res.text();
      throw new Error(`status ${res.status}: ${text.slice(0, 200)}`);
    }
    setLog(text || 'ok');
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
selectAllEl.addEventListener('change', () => {
  const checked = selectAllEl.checked;
  mediaSelections = mediaSelections.map((m) => ({ ...m, selected: checked }));
  renderMediaList();
});

