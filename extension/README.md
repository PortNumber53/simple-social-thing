# Simple Social Clip (Chrome Extension)

Side-panel extension to send media/posts from supported social networks into your Simple Social Thing backend. It reuses the same auth (cookies) as the web app; user-initiated only.

## Supported networks
- Instagram, Facebook, TikTok, Pinterest, YouTube, Threads (.net/.com), X/Twitter (matches via host).

## How it works
- Content script scrapes the current page: URL, provider, media URLs (img/video), selected text, and OpenGraph meta.
- Side panel shows detected data; user can add notes and trigger a POST to your backend to queue the download/copy job.
- Authentication: uses `credentials: 'include'` so existing session cookies are sent (matches frontend auth). Can be disabled in settings.

## Build/Load
1) No build step; files are plain JS/HTML/CSS in `extension/chrome/`.
2) In Chrome, open `chrome://extensions`, enable Developer Mode, click “Load unpacked”, and select the `extension/chrome` folder.

## Configuration
- Open the extension side panel or options page and set:
  - API Base URL (e.g., `https://simple.truvis.co` or `http://localhost:18910`)
  - Endpoint Path (default `/api/library/import`)
  - “Send cookies” toggle (on by default).
- Requests POST JSON:
  ```json
  {
    "url": "<page url>",
    "provider": "instagram|tiktok|pinterest|youtube|threads|twitter|facebook|unknown",
    "media": [{ "type": "image|video", "src": "<url>" }],
    "selection": "<selected text>",
    "meta": { "title": "...", "description": "...", "image": "...", "video": "..." },
    "notes": "<user notes>"
  }
  ```

## Files
- `manifest.json` — MV3 manifest with sidePanel and content scripts.
- `background.js` — opens side panel on action.
- `content.js` — per-site scraping of media/meta.
- `sidepanel.html/js/css` — UI to review and send to backend.
- `options.html/js` — configure API base and endpoint.

## Notes
- All actions are user-initiated; no background polling.
- Backend must accept the POST at the configured endpoint and queue the actual download/copy job.
