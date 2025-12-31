## Simple Social Thing

Full-stack app for connecting social accounts, importing a user’s social content into a unified library, and publishing posts/videos to multiple networks.

### Architecture (current)
- **Frontend (Vite + React + TS)**: `frontend/` (dev server on **18910**)
- **Cloudflare Worker (API gateway + OAuth + webhooks + assets)**: `frontend/worker/index.ts` (Wrangler dev on **18912**)
  - Serves SPA assets via `ASSETS` binding with SPA fallback.
  - Handles OAuth flows and callback endpoints for providers (Google, Instagram, TikTok, YouTube, Pinterest, Threads).
  - Proxies/forwards app API calls to the Go backend (and provides structured error responses).
  - Provides realtime publish updates to the frontend via WebSocket endpoint.
- **Backend (Go net/http + gorilla/mux + Postgres)**: `backend/` (API on **18911**)
  - Runs DB migrations on startup from `backend/db/migrations/`.
- Stores user/provider tokens in `public.user_settings` (JSONB) and maintains `social_connections`.
  - Persists created/imported content into `SocialLibraries`.
- Publishes asynchronously via `publish_jobs` (backend) + Worker WebSocket streaming (frontend).
  - Serves uploaded media under `/media/` (required for providers that fetch public URLs, e.g. Instagram).

### Standard local dev ports
- **Frontend**: `http://localhost:18910`
- **Worker**: `http://localhost:18912`
- **Backend**: `http://localhost:18911`

### Local development (quick start)
#### 1) Backend (Go + Postgres)
1. Ensure Postgres is running and you have a DB.
2. Create `backend/.env` (or a root `.env`) with at least:
   - `DATABASE_URL=postgresql://...`
   - `PORT=18911` (optional; defaults to 18911)
3. Start the API (it auto-runs migrations on startup):

```bash
cd backend
go run ./cmd/api
```

#### 2) Worker + Frontend (Wrangler + Vite)
1. Copy Worker dev vars and fill in provider secrets:

```bash
cp _dev.vars_example frontend/.dev.vars
```

2. Install deps and run dev (starts **both** Vite 18910 + Wrangler 18912):

```bash
cd frontend
npm ci
npm run dev
```

Notes:
- Vite proxies `/api/*` to the Worker on 18912 (`frontend/vite.config.ts`).
- In local dev, the Worker uses `BACKEND_ORIGIN` (from `frontend/.dev.vars`) to call the Go backend on 18911.

### Database migrations
- **Automatic**: the Go backend runs migrations on startup (`backend/cmd/api/main.go`).
- **Manual** (from `backend/`):

```bash
go run db/migrate.go -direction=up
```

CI also runs migrations via `deploy/dbtool-migrate.sh` before deploy.

### Publishing (async + realtime)
- Frontend submits publish requests to the Worker (`/api/posts/publish`), which enqueues a backend job.
- Backend runs the fan-out and persists results in `publish_jobs`.
- Frontend receives progress/results via Worker WebSocket: `/api/posts/publish/ws?jobId=...`.

Current publish support:
- **Facebook Pages**: text + images
- **Instagram**: images (container creation + polling)
- **TikTok**: video (requires `video.upload` / `video.publish` scopes + product approval in TikTok Dev Portal)
- **YouTube**: video upload (requires `https://www.googleapis.com/auth/youtube.upload`)

### Webhooks (Worker)
- **Facebook** verification/callback: `/api/webhook/facebook/callback` (uses `FACEBOOK_WEBHOOK_TOKEN`)
- **TikTok** callback: `/api/webhooks/tiktok/callback`
- **Suno** callback goes to backend: `/callback/suno/music`

### CI/CD (Jenkins + Cloudflare)
- `Jenkinsfile`:
  - builds Go binaries for `amd64` + `arm64`
  - runs DB migrations
  - deploys backend binaries to hosts via `deploy/jenkins-deploy-amd64.sh`
  - deploys Worker + frontend assets to Cloudflare via `deploy/jenkins-deploy-frontend.sh` (non-interactive secret syncing)

### Where to look for more details
- **Provider secrets / prod credential IDs**: `NOTES.md`
- **Deployment docs**: `deploy/README.md`
- **Backend docs**: `backend/README.md`
