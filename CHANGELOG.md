# Changelog

## 2025-11-05

- Frontend Worker: Hardened error handling for Suno API key endpoint
  - `GET /api/integrations/suno/api-key` now returns `{ ok: false, error: 'backend_unreachable' }` (502) when the Go backend cannot be reached instead of throwing "Network connection lost.".
  - Non-OK backend responses now surface as `{ ok: false, error: 'backend_error', status, details }` (502) instead of crashing the Worker.
  - `PUT /api/integrations/suno/api-key` now returns `{ ok: false, error: 'backend_unreachable' }` (502) when the Go backend cannot be reached.
  - Preserves `sid` Set-Cookie behavior for local dev when issuing a new session.

### Backend
- Implemented graceful shutdown on Ctrl+C (SIGINT/SIGTERM)
  - Handle OS signals and call `http.Server.Shutdown` with a 5s timeout to stop cleanly when running via `air` or directly.

### Suno Integration
- Corrected API base and path to `https://api.sunoapi.org/api/v1/generate`.
- Implemented async polling of `generate/record-info` to retrieve `audioUrl` on SUCCESS.
- Polling strategy: 30 attempts over ~3 minutes with exponential backoff (2s, 4s, 6s, 8s, then 10s) to accommodate 1-2 minute generation time.
- Track generation lifecycle: Create task record immediately with taskId, poll for completion, update with audioUrl and status (pending/completed/failed/timeout).
- Added `task_id`, `status`, `model`, `updated_at` columns to `suno_tracks` table (migration 004).
- Backend endpoints: `POST /api/suno/tasks` (create), `PUT /api/suno/tracks/{id}` (update).
- Removed mock fallbacks; real API key required. Returns `missing_suno_api_key` (400) when absent.
- Added detailed logging in Worker (request, taskId, poll status) and Backend (store, user-settings) to aid debugging.
- Added model selector UI (V3_5, V4, V4_5, V4_5PLUS, V5) with V4 default.
- Fixed required `callBackUrl` and `instrumental` parameters in generate requests (instrumental defaults to false for vocals).

### Bug Fixes
- Fixed `sqlUpsertSocial` ON CONFLICT clause to match schema's `UNIQUE("userId", provider)` constraint instead of `(provider, "providerId")`.
- Added error logging when backend is unreachable during local dev sid issuance for Suno API key endpoint.

## 2025-11-03

- Added Go backend API with hot reload, migrations, and multi-environment deployment.
- Improved security by removing hardcoded database credentials from wrangler configs.
- Fixed Hyperdrive local development configuration.
- Reduced database query timeout from 60s to 5s for faster OAuth flow.
- Updated Jenkins pipeline for automated deployments to production server.

### Backend
- Created Go backend with Air for hot reload development
  - `backend/cmd/api/main.go` - Main application entry point
- `backend/internal/handlers/handlers.go` - HTTP handlers for users, social_connections, teams
  - `backend/internal/models/models.go` - Data models
  - `backend/db/migrate.go` - Database migration tool
  - `backend/db/migrations/001_initial_schema.up.sql` - Initial schema migration
  - `backend/Makefile` - Convenience commands (dev, build, test, migrate-up, migrate-down)
  - `backend/.air.toml` - Air hot reload configuration
  - `backend/README.md` - Complete setup and usage documentation
- Added deployment infrastructure
  - `deploy/Jenkinsfile` - Multi-architecture build pipeline (amd64/arm64) with automated deployment to web1
  - `deploy/dbtool-migrate.sh` - Database migration script for Jenkins
  - Config is generated from Jenkins secrets on deploy
  - `deploy/README.md` - Complete deployment documentation
  - `deploy/deploy-{dev,staging,production}.sh` - Legacy environment-specific deployment scripts
  - `deploy/systemd/*.service` - Legacy systemd service files
- Backend runs on port `18911` with hot reload via Air
- Jenkins pipeline deploys to `/var/www/vhosts/simple.truvis.co` on web1
- Automated config setup: writes `/etc/simple-social-thing/config.ini` from Jenkins secrets on every deploy

### Frontend
- `frontend/worker/index.ts`
  - Reduced database query timeout from 60 seconds to 5 seconds for faster OAuth callback
  - Improved error handling and logging for database operations
- `frontend/package.json`
  - Updated `dev:worker` script to source `.dev.vars` and set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` from `DATABASE_URL`
  - Uses bash with `set -a` to properly export environment variables
- `frontend/wrangler.jsonc`
  - Removed hardcoded database connection string (production config)
- `frontend/wrangler.dev.jsonc`
  - Created separate dev configuration
  - Removed hardcoded `localConnectionString` - now uses environment variable
- `frontend/.dev.vars.example`
  - Updated port references to `18910/18911/18912`

### Security Improvements
- No hardcoded database credentials in version-controlled files
- `.dev.vars` properly gitignored
- Production uses Cloudflare Hyperdrive config (secure)
- Local development uses environment variable for database connection

### Notes
- Start backend dev: `cd backend && make dev`
- Start frontend dev: `cd frontend && npm run dev`
- Run migrations: `cd backend && make migrate-up`

## 2025-10-22

- Migrate persistence from Xata REST to Postgres via Cloudflare Hyperdrive in the Worker.

### Changes
- `frontend/worker/index.ts`
  - Add Hyperdrive SQL client using `postgres` with dev fallback to `DATABASE_URL`.
  - Implement `sqlUpsertUser()` that updates by `email` first and returns canonical `Users.id`; insert otherwise. Populates `imageUrl`.
  - Implement `sqlUpsertSocial()` with conflict target `(provider, "providerId")` to avoid duplicate key violations and update `userId/email/name` on conflict.
- Use canonical `users.id` for `social_connections.user_id` and for the `sid` cookie to satisfy FK constraints.
  - Status endpoint reads Instagram connection from DB; falls back to cookie when unavailable.
  - Add error logging around DB operations.
- `frontend/wrangler.jsonc`
  - Enable Node.js compatibility: `"compatibility_flags": ["nodejs_compat"]`.
  - Bind Hyperdrive by `id` and document local dev setup.
- `frontend/package.json`
  - Add dependency: `postgres`.
- `.windsurf_plan.md`
  - Update plan to reflect Hyperdrive-based architecture and local dev instructions.

### Notes
- For local dev, start with:
  - `export DATABASE_URL="postgresql://…?sslmode=require"`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL" npm run dev`

## 2025-10-17

- Updated Google OAuth flow and local dev tooling for `frontend/`.
- Implemented dynamic OAuth redirect handling to prevent 404s and redirect_uri mismatches.

### Changes
- `frontend/worker/index.ts`
  - Build `redirect_uri` dynamically from the incoming request origin in `handleOAuthCallback()`.
  - Use computed `redirect_uri` during token exchange.
  - Integrated Xata persistence using REST (no generated types).
  - Upsert `public.Users` with `id`, `email`, `name`, and `imageUrl`.
- Upsert `public.social_connections` with deterministic `id = "${provider}:${providerId}"`, plus `user_id`, `provider`, `provider_id`, `email`, `name`.
  - Normalized avatar field to `imageUrl` in OAuth return payload.
  - Added `USE_MOCK_AUTH` env flag to disable localhost mock by default.
- `frontend/src/components/GoogleLoginButton.tsx`
  - Build `redirect_uri` using `VITE_WORKER_ORIGIN` with fallback to `window.location.origin`.
  - Switch Google authorize endpoint to `https://accounts.google.com/o/oauth2/v2/auth`.
- `frontend/vite.config.ts`
  - Conditionally include `@cloudflare/vite-plugin` using `VITE_DISABLE_CF_PLUGIN` via `loadEnv` to avoid Miniflare port conflicts during `vite dev`.
- `frontend/package.json`
  - Add `concurrently` and new scripts to launch Vite and Wrangler together.
  - Set `VITE_DISABLE_CF_PLUGIN=1` for `dev:client` to ensure plugin is disabled during dev.
  - Add `@types/node` to devDependencies.
- `frontend/.env.local` (developer env)
  - Documented recommended entries: `VITE_WORKER_ORIGIN=http://localhost:18912`, `VITE_DISABLE_CF_PLUGIN=1`, and `VITE_GOOGLE_CLIENT_ID`.
- `.windsurf_plan.md`
  - Added project plan with dev/prod OAuth guidance and deployment notes.
- `frontend/wrangler.jsonc`
  - Fixed Wrangler error by adding SPA not_found handling.
  - Updated production assets to serve from `./dist/` to avoid 404 at root after deploy.
- `frontend/src/App.tsx`
  - Display user avatar when authenticated using `user.imageUrl` with placeholder fallback.
- `frontend/src/pages/Home.tsx`
  - Remove auto-redirect for authenticated users from `/` to `/dashboard`; Home is now accessible when logged in.
  - Render `TopNavigation` so the top-right account menu is visible on the homepage when logged in.
- Branding & Copy updates
  - Home hero title changed to "Simple Social Thing" and subheading reframed to value-driven copy.
  - Removed technology logos from Home; footer copy now highlights product benefits.
  - Browser title and meta description updated in `frontend/index.html`.
- UI/Navigation
  - Top brand changed to link to `/` and read "Simple Social Thing".
  - Center nav now shows `Home / Features / Contact`; added pages and routes.
  - Account menu moved actions into dropdown; avatar/name links to `/dashboard`.
  - Improved dropdown UX: hover to open, stronger hover/focus states, removed hover gap.
  - Always-visible vertical scrollbar to prevent layout shift.
- Pages
  - Added `frontend/src/pages/Features.tsx` and `frontend/src/pages/Contact.tsx` (with form).
  - Added `frontend/src/pages/Pricing.tsx` with three tiers (Free, Pro $100/mo, Team $100/seat/mo); wired route `/pricing` and nav link.
  - Added legal pages: `frontend/src/pages/PrivacyPolicy.tsx` (`/privacy-policy`) and `frontend/src/pages/TermsOfService.tsx` (`/terms-of-service`).
- SPA Routing (Cloudflare Workers)
  - Bound static assets with `binding: ASSETS` in `wrangler.jsonc` and delegated non-API requests in `worker/index.ts` to enable client-side routes (e.g., `/dashboard`).
- Auth UX
  - Synchronous auth hydration from `localStorage` in `AuthContext` to eliminate header flash. Only show loading during OAuth callback processing.
- Fonts
  - Preconnected and loaded Inter via `<link>` in `index.html`; removed CSS `@import` to reduce flash.
- Visual polish
  - Prevented H1 descender clipping on Home by adjusting line-height/padding.
- Footer
  - Added global footer component with links to `/privacy-policy` and `/terms-of-service`; included on Home, Contact, Pricing, Integrations, Privacy Policy, and Terms pages.
  - Added `User Data Deletion` link to `/user-data-deletion`.
 - Legal
  - Added `frontend/src/pages/UserDataDeletion.tsx` and wired route `/user-data-deletion`.
- Database
  - Added column `imageUrl text` to `public.Users`.

### Notes
- Ensure Google OAuth client has Authorized redirect URI:
  - Dev: `http://localhost:18912/api/auth/google/callback`
  - Prod: `https://<your-worker-domain>/api/auth/google/callback`
- Start dev: `npm run dev` (client on 18910, worker on 18912).
