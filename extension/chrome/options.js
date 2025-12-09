const apiBaseEl = document.getElementById('apiBase');
const endpointEl = document.getElementById('endpointPath');
const useCredsEl = document.getElementById('useCredentials');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function load() {
  const { apiBase = '', endpointPath = '/api/library/import', useCredentials = true } = await chrome.storage.sync.get([
    'apiBase',
    'endpointPath',
    'useCredentials'
  ]);
  apiBaseEl.value = apiBase;
  endpointEl.value = endpointPath;
  useCredsEl.checked = useCredentials;
}

async function save() {
  await chrome.storage.sync.set({
    apiBase: apiBaseEl.value.trim(),
    endpointPath: endpointEl.value.trim(),
    useCredentials: useCredsEl.checked
  });
  setStatus('Saved');
}

document.addEventListener('DOMContentLoaded', load);
saveBtn.addEventListener('click', save);

