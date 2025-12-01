# WebSocket Notes (Dev + Debugging)

This project uses WebSockets for **realtime UI updates** (e.g. scheduled post rows disappearing immediately after a publish completes).

The WebSocket path is **browser-facing**, but the actual event source is the **Go backend**. The worker bridges both sides safely.

---

## Architecture (who talks to whom)

### Browser-facing WebSocket

- The browser connects to:
  - **`wss://<public-host>/api/events/ws`**
    - Example: `wss://simple.dev.portnumber53.com/api/events/ws`

### Worker bridges the browser WS to backend WS

- The **Cloudflare Worker** receives `/api/events/ws` and:
  - Authenticates the browser using the `sid` cookie (HttpOnly).
  - Opens an **internal WS** connection to the backend:
    - `GET {BACKEND_ORIGIN}/api/events/ws?userId=<sid>`
  - Streams messages between the 2 sockets.

### Backend is the event producer

- The **Go backend** hosts:
  - `GET /api/events/ws?userId=...` (internal WS endpoint)
  - `GET /api/events/ping` (debug endpoint; validates internal WS auth + loopback detection)

The backend emits events at:
- Publish completion (`post.publish`).
- A debug “clock tick” (`clock`) once per second **over the WS** (used by the footer to prove connectivity end-to-end).

---

## Endpoints and message types

### Worker (browser-facing)

- `GET /api/events/ws`
  - Requires `sid` cookie.
  - Bridges to backend WS.

### Backend (internal)

- `GET /api/events/ws?userId=<sid>`
  - Intended to be called by the Worker (not directly by the browser).
- `GET /api/events/ping`
  - Returns a JSON debug object like:
    - `ok`, `loopback`, `secSet`, `hasHeader`, `headerMatch`, `remote`, `host`

### Message types

The backend sends JSON string messages:

- **Clock (debug)**
  - `{"type":"clock","userId":"...","now":"HH:MM:SS","at":"RFC3339"}`
  - Powers the bottom status bar “Backend UTC” clock. If it stops, WS is broken.

- **Post publish completion**
  - `{"type":"post.publish","userId":"...","postId":"...","jobId":"...","status":"completed|failed","at":"RFC3339"}`
  - The Library page listens for this and refreshes the Scheduled/Draft list.

---

## Local dev: required configuration

### 1) Backend env (`backend/.env`)

Must include:

- **`DATABASE_URL=...`**
- **`PUBLIC_ORIGIN=https://simple.dev.portnumber53.com`**
  - Used to build provider-facing media URLs (and shows up in publish worker logs).
- **`INTERNAL_WS_SECRET=...`**
  - Used to authenticate Worker→Backend WS for non-loopback scenarios.
  - In dev, we also allow loopback regardless (see “Security model”).

### 2) Worker dev vars (`frontend/.dev.vars`)

Must include:

- **`BACKEND_ORIGIN=http://127.0.0.1:18911`**
  - Recommended for local dev to avoid routing backend calls through nginx.
- **`INTERNAL_WS_SECRET=...`**
  - Must match `backend/.env`.

Important:
- Use `127.0.0.1` (not `localhost`) to avoid IPv6 resolution pitfalls.

### 3) Vite proxy (frontend dev)

`frontend/vite.config.ts` proxies `/api/*` and `/media/*` to the worker (`18912`).

Key points:
- Proxy target uses **`http://127.0.0.1:18912`** (not `localhost`).
- WS header forwarding (`X-Forwarded-*`) is applied for both:
  - HTTP requests (`proxyReq`)
  - WS requests (`proxyReqWs`)

---

## nginx (dev wildcard reverse proxy)

Your public hostname (e.g. `simple.dev.portnumber53.com`) routes to Vite.

For WS, nginx must pass upgrade headers:

- `proxy_http_version 1.1;`
- `proxy_set_header Upgrade $http_upgrade;`
- `proxy_set_header Connection $connection_upgrade;`
- Use `proxy_pass $dev_upstream$request_uri;` to preserve query strings

You already have a working example in `_dev.portnumber53.com.conf`.

---

## Security model (why this is safe)

### Browser → Worker

- Browser only talks to Worker.
- Browser auth is by `sid` cookie.

### Worker → Backend

Backend `GET /api/events/ws` accepts if:
- **Loopback** (dev convenience), OR
- `X-Internal-WS-Secret` matches backend `INTERNAL_WS_SECRET`.

Note:
- We intentionally disabled the default `Origin` enforcement for the backend WS endpoint since it’s an **internal channel** and origin checks caused false 403s.

---

## Debugging playbook (when WS breaks)

### Symptom: footer says “WS disconnected” or clock doesn’t tick

1) **Check Worker logs**:
   - `[EventsWS] connect ... hasSecret=true|false`
   - `[EventsWS] ping status=... body=...`
   - `[EventsWS] upstream_rejected status=...`

2) Validate backend is reachable from the Worker:
   - Ensure `BACKEND_ORIGIN` is correct (`http://127.0.0.1:18911` in dev).

3) Validate backend auth logic using ping:
   - Hit (through Worker):
     - `GET https://<public-host>/api/events/ws` should connect
   - In Worker logs, `ping ok=true` is the green light.

4) If ping is ok but WS is 403:
   - This used to be the backend websocket `Origin` check. We fixed this by using a custom handshake that accepts any origin.

5) If HTTP endpoints return 502 but `integrations/status` works:
   - Worker is up but **backend origin is wrong** (or routed through nginx incorrectly).
   - Fix by setting `BACKEND_ORIGIN` in `frontend/.dev.vars`.

### Common root causes we’ve hit

- **Wrong backend origin**:
  - Worker picking `https://api-simple...` and hitting nginx when it should call localhost.
  - Fix: `BACKEND_ORIGIN=http://127.0.0.1:18911`.

- **IPv6 localhost mismatch**:
  - `localhost` resolves to `::1` but wrangler/vite is on IPv4.
  - Fix: use `127.0.0.1` in Vite proxy targets.

- **WS upgrade headers dropped**:
  - nginx or another proxy not forwarding `Upgrade` / `Connection`.
  - Fix nginx location block.

- **Secret mismatch**:
  - `INTERNAL_WS_SECRET` differs between backend and worker.
  - Fix: set identical values; confirm via `ping headerMatch=true`.

---

## “Known good” checklist

- `BACKEND_ORIGIN=http://127.0.0.1:18911` in `frontend/.dev.vars`
- `INTERNAL_WS_SECRET` set in both backend and worker env (same value)
- `PUBLIC_ORIGIN=https://simple.dev.portnumber53.com` in `backend/.env`
- `https://simple.dev.portnumber53.com/api/user-settings` returns 200 (no 502)
- Footer shows:
  - **WS connected**
  - **Backend UTC ticks every second**
