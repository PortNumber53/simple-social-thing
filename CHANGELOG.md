# Changelog

## 2025-10-17

- Updated Google OAuth flow and local dev tooling for `frontend/`.
- Implemented dynamic OAuth redirect handling to prevent 404s and redirect_uri mismatches.

### Changes
- `frontend/worker/index.ts`
  - Build `redirect_uri` dynamically from the incoming request origin in `handleOAuthCallback()`.
  - Use computed `redirect_uri` during token exchange.
  - Integrated Xata persistence using REST (no generated types).
  - Upsert `public.Users` with `id`, `email`, `name`, and `imageUrl`.
  - Upsert `public.SocialConnections` with deterministic `id = "${provider}:${providerId}"`, plus `userId`, `provider`, `providerId`, `email`, `name`.
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
  - Documented recommended entries: `VITE_WORKER_ORIGIN=http://localhost:8787`, `VITE_DISABLE_CF_PLUGIN=1`, and `VITE_GOOGLE_CLIENT_ID`.
- `.windsurf_plan.md`
  - Added project plan with dev/prod OAuth guidance and deployment notes.
- `frontend/wrangler.jsonc`
  - Fixed Wrangler error by adding `assets.directory: ./public/` and SPA not_found handling.
- `frontend/src/App.tsx`
  - Display user avatar when authenticated using `user.imageUrl` with placeholder fallback.
- Database
  - Added column `imageUrl text` to `public.Users`.

### Notes
- Ensure Google OAuth client has Authorized redirect URI:
  - Dev: `http://localhost:8787/api/auth/google/callback`
  - Prod: `https://<your-worker-domain>/api/auth/google/callback`
- Start dev: `npm run dev` (client on 5173, worker on 8787).
