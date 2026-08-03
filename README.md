# Social Manager Thing

Full-stack app for connecting social accounts, importing social content into a unified library, and scheduling/publishing Instagram Business Account content.

This repository is the active implementation base for Jira project **SMT / Social Manager Thing**. It was consolidated from the former Simple Social Thing codebase; the original SMT scaffold is preserved in the archived scaffold repository.

## Product scope

The MVP is focused on Instagram Business Account management:

- Google/Facebook login
- Meta/Facebook OAuth for Instagram Business Account connection
- secure server-side provider token storage
- draft, scheduled, published, and failed post tracking
- Instagram Graph API publishing
- AI-assisted Instagram posts, captions, hashtags, strategy, and chat (with streaming)
- configurable FLUX/MFlux-compatible image generation
- Instagram profile and account/media insights
- team roles: Admin, Editor, Viewer
- Stripe tiers:
  - **Free** — 1 post per day
  - **Standard** — 10 posts per day
  - **Pro** — capped by Meta rate limits

See `docs/PRD.md` for the imported Social Manager Thing product requirements.

## Architecture (current)

- **Frontend (Vite + React + TS)**: `frontend/` (dev server on **18910**)
- **Cloudflare Worker (API gateway + OAuth + webhooks + assets)**: `frontend/worker/index.ts` (Wrangler dev on **18912**)
  - Serves SPA assets via `ASSETS` binding with SPA fallback.
  - Handles OAuth flows and callback endpoints for social providers.
  - Proxies/forwards app API calls to the Go backend with structured error responses.
  - Provides realtime publish updates to the frontend via WebSocket endpoint.
- **Backend (Go net/http + gorilla/mux + Postgres)**: `backend/` (API on **18911**)
  - Handles Google OAuth login callback (`/auth/google/callback`).
  - Runs DB migrations on startup from `backend/db/migrations/`.
  - Stores user/provider tokens in `public.user_settings` (JSONB) and maintains `social_connections`.
  - Persists created/imported content into `SocialLibraries`.
  - Publishes asynchronously via `publish_jobs` + Worker WebSocket streaming.
  - Serves uploaded media under `/media/` for providers that need public fetchable URLs.

## Standard local dev ports

- **Frontend**: `http://localhost:18910`
- **Worker**: `http://localhost:18912`
- **Backend**: `http://localhost:18911`

## Local development (quick start)

### 1) Backend (Go + Postgres)

1. Ensure Postgres is running and you have a DB.
2. Create `backend/.env` or a root `.env` with at least:
   - `DATABASE_URL=postgresql://...`
   - `PORT=18911` (optional; defaults to 18911)
3. Start the API:

```bash
cd backend
go run ./cmd/api
```

### 2) Worker + Frontend (Wrangler + Vite)

1. Copy Worker dev vars and fill in provider secrets:

```bash
cp _dev.vars_example frontend/.dev.vars
```

2. Install deps and run dev:

```bash
cd frontend
npm ci
npm run dev
```

Notes:

- Vite proxies `/api/*` to the Worker on 18912 (`frontend/vite.config.ts`).
- In local dev, the Worker uses `BACKEND_URL` from `frontend/.dev.vars` to call the Go backend on 18911.

## Database migrations

- **Automatic**: the Go backend runs migrations on startup (`backend/cmd/api/main.go`).
- **Manual** from `backend/`:

```bash
go run db/migrate.go -direction=up
```

CI also runs migrations via `deploy/dbtool-migrate.sh` before deploy.

## Publishing (async + realtime)

- Frontend submits publish requests to the Worker (`/api/posts/publish`), which enqueues a backend job.
- Backend runs the publish workflow and persists results in `publish_jobs`.
- Frontend receives progress/results via Worker WebSocket: `/api/posts/publish/ws?jobId=...`.

Current publish support inherited from Simple Social Thing:

- **Facebook Pages**: text + images
- **Instagram**: images (container creation + polling)
- **TikTok**: video (requires approved scopes)
- **YouTube**: video upload

## Instagram Agent

The authenticated **Content → Instagram Agent** page adds the content-generation and analytics tools ported from the standalone Instagram-Agent project:

- streaming chat and generation for posts, captions, hashtags, and content strategy, with an optional concise rationale
- optional OpenAI-compatible image generation
- Instagram Business profile details and account/media insights
- manual refresh of the connected account's long-lived Meta token
- one-click handoff of generated text to the existing composer

Configure the backend with `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`. Image generation defaults to `${LLM_BASE_URL}/images/generations`; override it with `LLM_IMAGE_ENDPOINT` and `LLM_IMAGE_MODEL` when the image service is separate.

The SMT product path should prioritize Instagram/Meta first; other providers remain secondary until deliberately productized.

## Webhooks (Worker)

- **Facebook** verification/callback: `/api/webhook/facebook/callback`
- **TikTok** callback: `/api/webhooks/tiktok/callback`
- **Suno** callback goes to backend: `/callback/suno/music`

## CI/CD (Jenkins + Cloudflare)

- `Jenkinsfile` builds Go binaries for `amd64` + `arm64`, runs DB migrations, deploys backend binaries, and deploys Worker + frontend assets to Cloudflare.

## More details

- Provider secrets / prod credential IDs: `NOTES.md`
- Deployment docs: `deploy/README.md`
- Backend docs: `backend/README.md`
- Consolidation notes: `docs/consolidation/SMT_IMPORT.md`
