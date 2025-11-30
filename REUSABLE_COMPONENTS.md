# Reusable Components / Modules Audit

This document summarizes repeated patterns in the codebase that are strong candidates to extract into reusable components, hooks, and shared modules.

## Frontend (React) — components to extract

### UI primitives (low risk, high reuse)
- **`AlertBanner` / `InlineNotice`**
  - **Seen in**: `frontend/src/pages/Settings.tsx`, `frontend/src/pages/Profile.tsx`
  - **Why**: duplicated conditional styling + icon + message rendering.
  - **Suggested API**: `variant: 'success' | 'error' | 'info' | 'warning'`, `title?`, `children`, `dismissible?`, `onDismiss?`.

- **`SegmentedControl`**
  - **Seen in**: `frontend/src/pages/ContentPublished.tsx` (List/Gallery), `frontend/src/pages/Library.tsx` (Drafts/Scheduled)
  - **Why**: repeated “pill” toggle UI with identical class chains.
  - **Suggested API**: `options: { value: string; label: string; disabled?: boolean }[]`, `value`, `onChange`, `size?`.

- **`LabeledField` + `LabeledSelect` + `LabeledInput`**
  - **Seen in**: `frontend/src/pages/ContentPublished.tsx` filter grid
  - **Why**: consistent “label + control” blocks; reuse drives consistent visuals and reduces copy/paste Tailwind.

- **`IconButton`**
  - **Seen in**: `frontend/src/pages/ContentPublished.tsx` date clear buttons (and likely future pages)
  - **Why**: repeated “small button with icon, accessible label” pattern.

### Domain components (feature-level reuse)
- **`IntegrationCard`**
  - **Seen in**: `frontend/src/pages/Integrations.tsx` (repeated per-provider)
  - **Why**: repeated structure (icon block, title, description, connected badge, connect/disconnect buttons, “learn more”).
  - **Suggested API**: `providerKey`, `title`, `description`, `icon`, `connected`, `connectedLabel?`, `primaryAction`, `secondaryActions[]`, `statusMessage?`.

- **`PublishedFiltersToolbar` + `PublishedBulkActionsBar`**
  - **Seen in**: `frontend/src/pages/ContentPublished.tsx`
  - **Why**: page mixes filtering, selection, refresh/sync/bulk delete, and view-mode toggles into one large component tree.

- **`PublishedTable` + `PublishedGallery`**
  - **Seen in**: `frontend/src/pages/ContentPublished.tsx`
  - **Why**: distinct view renderers that share the data model and selection rules; splitting improves readability and reuse on future archive-like pages.

- **`SelectableCard` (clickable card with checkbox overlay)**
  - **Seen in**: `frontend/src/pages/ContentPublished.tsx` gallery items
  - **Why**: selection overlay + click-to-open link behavior is reusable.

- **`ProviderPicker` + `FacebookPagePicker`**
  - **Seen in**: `frontend/src/pages/ContentPosts.tsx`
  - **Why**: non-trivial selection logic (provider support gating, tri-state FB checkbox, FB pages grid).
  - **Suggested API**: provide normalized view-model props; keep complex state internally or expose as a controlled component.

### Media / uploads UX (high leverage over time)
- **`MediaPicker`**
  - **Seen in**: `frontend/src/pages/ContentPosts.tsx`, `frontend/src/pages/Library.tsx`
  - **Why**: file input + preview management + remove/reorder patterns; reduces repeated URL.createObjectURL + cleanup logic.

- **`UploadGrid` / `DraggableMediaList` (Library-focused, but reusable)**
  - **Seen in**: `frontend/src/pages/Library.tsx`
  - **Why**: advanced upload management (drag-reorder, multi-select, error formatting) can become a reusable “asset manager” component.

## Frontend — hooks & utilities to extract

### API calling / request state
Repeated pattern across pages/contexts: `fetch(..., { credentials: 'include' })` + `await res.json().catch(...)` + `if (!res.ok) ...`.

- **`apiJson` / `apiFetch`**
  - **Seen in**: `AuthContext.tsx`, `IntegrationsContext.tsx`, `ContentMusic.tsx`, `ContentPublished.tsx`, `Library.tsx`, `Integrations.tsx`, etc.
  - **Goal**: standardize `credentials`, JSON parsing, and error shaping.

- **`useRequestState`**
  - **Goal**: unify `{ loading, error, run }` patterns and eliminate repeated `setLoading(true)/finally`.

### LocalStorage safe cache
Repeated “try/catch JSON.parse + fallback + localStorage.removeItem”.

- **`safeStorage`**
  - **Seen in**: `AuthContext.tsx`, `IntegrationsContext.tsx`, `Integrations.tsx`, `ContentMusic.tsx`
  - **Suggested API**: `getJSON<T>(key): T | null`, `setJSON(key, value)`, `remove(key)`.

- **`useLocalStorageState`**
  - **Seen in**: `ContentPublished.tsx` (`publishedViewMode`), plus several caches (`integrations_status`, `user_settings`)

### Selection / filtering / polling
- **`useSelectionSet<TId>`**
  - **Seen in**: `ContentPublished.tsx` selection + pruning + select-all-filtered

- **`normalizeText` / `textFilter` utils**
  - **Seen in**: `ContentPublished.tsx` filtering

- **`usePolling`**
  - **Seen in**: `ContentMusic.tsx` (poll when “pending”)

### Realtime job updates
- **`useJobWebSocket(jobId)`**
  - **Seen in**: `ContentPosts.tsx` WebSocket listener for publish jobs
  - **Goal**: consistently handle connect/reconnect, message parsing, state updates, error states.

## Worker (`frontend/worker/index.ts`) — reusable modules to extract

The worker repeats the same scaffolding in many handlers:
- CORS headers + OPTIONS preflight
- `sid` cookie extraction + local-dev `sid` auto-minting
- “ensure user exists” POST to backend (`/api/users`)
- standardized JSON error envelopes (`{ ok: false, error: ... }`)

Recommended extractions:
- **`withCors(request, { methods, allowHeaders? })`**
  - Centralize OPTIONS behavior and set `Access-Control-Allow-*`.

- **`requireSid(request, { allowLocalAutoCreate: boolean })`**
  - Returns `{ sid, headers }` and optionally appends the `Set-Cookie`.

- **`ensureBackendUser(backendOrigin, sid)`**
  - Centralize the local-dev “create user” best-effort behavior.

- **`proxyBackendJson({ request, backendOrigin, path, method, body, headers })`**
  - Centralize backend forwarding + error mapping (e.g., `backend_unreachable`).

- **`pollingWebSocketProxy({ request, sid, backendUrl, validateOwnership? })`**
  - Encapsulate the publish job WS pattern (`handlePublishJobWs`): poll backend, stream updates, close on terminal status.

## Backend (`backend/internal/handlers/handlers.go`) — reusable building blocks to extract

Backend handlers repeat:
- JSON response writing (`Content-Type` + `json.NewEncoder`)
- `http.Error(...)` for required vars and decode failures
- method guarding

Recommended extractions:
- **`writeJSON(w, status, v)`** and **`writeError(w, status, code, message, details?)`**
  - Standardize error envelopes (and keep clients consistent).

- **`requireMethod(r, ...methods)`**
- **`pathVar(r, key)`** / **`mustPathVar(...)`**
- **`decodeJSON(r, &dst)`** (including consistent “invalid json body”)

- **Parsing utilities**
  - Pagination/date parsing and validation helpers (to reduce repeated query-param checking).

## Suggested implementation order (highest ROI first)
1. **Frontend**: `AlertBanner`, `SegmentedControl`, `safeStorage` + `apiJson`
2. **Frontend**: `useSelectionSet`, `usePolling`, `useJobWebSocket`
3. **Frontend**: `IntegrationCard`, `ProviderPicker`, `MediaPicker`
4. **Worker**: `withCors`, `requireSid`, `ensureBackendUser`, `proxyBackendJson`
5. **Backend**: `writeJSON/writeError`, decoding + param/method helpers
