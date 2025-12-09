const SUPPORTED_MATCHERS = [
  '*://*.instagram.com/*',
  '*://*.facebook.com/*',
  '*://*.tiktok.com/*',
  '*://*.pinterest.com/*',
  '*://*.youtube.com/*',
  '*://*.threads.net/*',
  '*://*.threads.com/*',
  '*://*.x.com/*',
  '*://*.twitter.com/*'
];

chrome.runtime.onInstalled.addListener(() => {
  // Enable the side panel on supported sites.
  chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error('Failed to open side panel', err);
  }
});

// Keep a lightweight handler to let the side panel fetch page data via the content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'getSupportedMatchers') {
    sendResponse({ matchers: SUPPORTED_MATCHERS });
    return true;
  }
  return false;
});

