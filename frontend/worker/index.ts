import postgres from 'postgres';

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  USE_MOCK_AUTH?: string;
  ASSETS?: Fetcher;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  FACEBOOK_WEBHOOK_TOKEN?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  PINTEREST_CLIENT_ID?: string;
  PINTEREST_CLIENT_SECRET?: string;
  BACKEND_ORIGIN?: string;
  DATABASE_URL?: string;
  // Hyperdrive binding is available on env.HYPERDRIVE in CF
  HYPERDRIVE?: { connectionString?: string };
}

// --- Hyperdrive (Postgres) helpers ---
type SqlClient = ReturnType<typeof postgres> | null;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as JsonRecord;
}

function getString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractCreditsNumber(value: unknown): number | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const dataAny = obj['data'];
  // Suno may return a raw number here (e.g. { code, msg, data: 14.0 })
  const direct = getNumber(dataAny);
  if (direct !== null) return direct;

  const dataObj = asRecord(dataAny);
  if (!dataObj) return null;

  const preferredKeys = [
    'availableCredits',
    'available_credits',
    'remainingCredits',
    'remaining_credits',
    'remaining',
    'remain',
    'credit',
    'credits',
    'balance',
    'totalCredits',
    'total_credits',
  ];

  for (const k of preferredKeys) {
    if (k in dataObj) {
      const n = getNumber(dataObj[k]);
      if (n !== null) return n;
    }
  }

  for (const [k, v] of Object.entries(dataObj)) {
    if (!/credit|balance|remain|available/i.test(k)) continue;
    const n = getNumber(v);
    if (n !== null) return n;
  }

  for (const v of Object.values(dataObj)) {
    const n = getNumber(v);
    if (n !== null) return n;
  }

  return null;
}

function logLarge(tag: string, text: string) {
  // Cloudflare logs can truncate long messages; chunk so we can see the full payload.
  const chunkSize = 3500;
  if (text.length <= chunkSize) {
    console.log(tag, text);
    return;
  }
  console.log(tag, `(len=${text.length})`);
  for (let i = 0; i < text.length; i += chunkSize) {
    console.log(tag, text.slice(i, i + chunkSize));
  }
}

function getSql(env: Env): SqlClient {
  try {
    // Prefer Hyperdrive binding in prod; in local, if it resolves to hyperdrive.local (Miniflare),
    // fall back to DATABASE_URL to avoid local CONNECT_TIMEOUTs.
    let cs: string | undefined = env.HYPERDRIVE?.connectionString;
    if (!cs || /hyperdrive\.local/i.test(cs)) {
      cs = env.DATABASE_URL || cs;
    }
    if (!cs) return null;
    return postgres(cs, {
      ssl: 'require',
      connect_timeout: 5,  // 5 second timeout instead of default 30s
      idle_timeout: 10,
      max_lifetime: 60
    });
  } catch {
    return null;
  }
}

async function sqlUpsertUser(sql: NonNullable<SqlClient>, user: { id: string; email: string; name: string; imageUrl?: string | null }): Promise<string> {
  // Try update by email first (handles existing rows created with a different id)
  const updated = await sql<{ id: string }[]>`
    UPDATE public."Users"
    SET name = ${user.name}, "imageUrl" = ${user.imageUrl ?? null}
    WHERE email = ${user.email}
    RETURNING id;
  `;
  if (updated.length > 0) return updated[0].id;

  // If no row for that email, insert a new one using the Google id
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO public."Users" (id, email, name, "imageUrl")
    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.imageUrl ?? null})
    ON CONFLICT (id) DO UPDATE SET
      email=EXCLUDED.email,
      name=EXCLUDED.name,
      "imageUrl"=EXCLUDED."imageUrl"
    RETURNING id;
  `;
  return inserted[0]?.id ?? user.id;
}

async function sqlUpsertSocial(sql: NonNullable<SqlClient>, conn: { userId: string; provider: string; providerId: string; email?: string | null; name?: string | null }) {
  const id = `${conn.provider}:${conn.providerId}`;
  await sql`
    INSERT INTO public."SocialConnections" (id, "userId", provider, "providerId", email, name, "createdAt")
    VALUES (${id}, ${conn.userId}, ${conn.provider}, ${conn.providerId}, ${conn.email ?? null}, ${conn.name ?? null}, NOW())
    ON CONFLICT (provider, "providerId") DO UPDATE SET
      "userId" = EXCLUDED."userId",
      email = EXCLUDED.email,
      name = EXCLUDED.name;
  `;
}

async function sqlQuerySocial(sql: NonNullable<SqlClient>, userId: string, provider: string) {
  const rows = await sql<{
    id: string; userId: string; provider: string; providerId: string; name: string | null
  }[]>`
    SELECT id, "userId", provider, "providerId", name
    FROM public."SocialConnections"
    WHERE "userId" = ${userId} AND provider = ${provider}
    ORDER BY "createdAt" DESC
    LIMIT 1;
  `;
  return rows[0] || null;
}

async function sqlDeleteSocial(sql: NonNullable<SqlClient>, userId: string, provider: string) {
  await sql`
    DELETE FROM public."SocialConnections"
    WHERE "userId" = ${userId} AND provider = ${provider};
  `;
}

// --- Generic cookie helpers ---
function getCookie(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    if (k === name) return decodeURIComponent(p.slice(idx + 1));
  }
  return null;
}

function buildSidCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
	const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
	const url = requestUrl ? new URL(requestUrl) : null;
	const parts = [
		`sid=${encodeURIComponent(value)}`,
		`Path=/`,
		`HttpOnly`,
		`SameSite=Lax`,
	];
	if (maxAgeSeconds > 0) {
		parts.push(`Max-Age=${maxAgeSeconds}`);
	} else {
		parts.push('Max-Age=0');
	}
	// Local dev: cookie must be visible to both :18910 and :18912 → set Domain=localhost
	if (url && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
		parts.push('Domain=localhost');
	}
	if (isHttps) parts.push('Secure');
	return parts.join('; ');
}

async function persistSocialConnection(
  _env: Env,
  _conn: { userId: string; provider: string; providerId: string; email?: string; name?: string }
) {
  // no-op: Hyperdrive SQL is authoritative
  void _env;
  void _conn;
}

async function persistUser(
  _env: Env,
  _user: { id: string; email: string; name: string; imageUrl?: string }
) {
  // no-op: Hyperdrive SQL is authoritative
  void _env;
  void _user;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Debug endpoint to help diagnose asset binding / routing issues in production.
    // (Safe: does not expose secrets; only reports whether ASSETS is present and whether index.html can be fetched.)
    if (url.pathname === "/__debug/assets") {
      const hasAssets = !!env.ASSETS;
      let indexStatus: number | null = null;
      if (env.ASSETS) {
        try {
          const indexUrl = new URL(request.url);
          indexUrl.pathname = "/index.html";
          const r = await env.ASSETS.fetch(new Request(indexUrl, request));
          indexStatus = r.status;
        } catch {
          indexStatus = -1;
        }
      }
      return Response.json({ ok: true, hasAssets, indexStatus });
    }

    // Debug endpoint to help diagnose backend connectivity / origin configuration.
    // Safe: does not expose secrets; only reports which backend origin is being used and whether /health is reachable.
    if (url.pathname === "/__debug/backend") {
      const backendOrigin = getBackendOrigin(env, request);
      const requestOrigin = url.origin;
      let healthStatus: number | null = null;
      let healthBody: string | null = null;
      try {
        const r = await fetch(`${backendOrigin}/health`, { headers: { Accept: 'application/json' } });
        healthStatus = r.status;
        healthBody = (await r.text().catch(() => '')).slice(0, 800);
      } catch (e) {
        healthStatus = -1;
        healthBody = e instanceof Error ? e.message : String(e);
      }
      return Response.json({
        ok: true,
        requestOrigin,
        backendOrigin,
        envHasBackendOrigin: !!env.BACKEND_ORIGIN,
        healthStatus,
        healthBody,
      });
    }

    // Suno callbacks (from https://docs.sunoapi.org/) - allow both with and without trailing slash.
    if (url.pathname === "/callback/suno/music" || url.pathname === "/callback/suno/music/") {
      return handleSunoCallback(request, env);
    }

    // Handle OAuth callback first (more specific route)
    if (url.pathname === "/api/auth/google/callback") {
      return handleOAuthCallback(request, env);
    }

    // Handle other API routes
    if (url.pathname.startsWith("/api/")) {
      // Facebook Webhook callback (Meta Webhooks product)
      if (url.pathname === "/api/webhook/facebook/callback") {
        return handleFacebookWebhook(request, env);
      }
      // User settings bundle for current session (sanitized; used for client-side caching)
      if (url.pathname === "/api/user-settings") {
        return handleUserSettingsBundle(request, env);
      }

      // DB ping endpoint
      if (url.pathname === "/api/db/ping") {
        const sql = getSql(env);
        if (!sql) {
          return Response.json({ ok: false, error: 'no_sql_client' }, { status: 503 });
        }
        try {
          await sql`select 1 as one`;
          return Response.json({ ok: true });
        } catch (e) {
          console.error('[DB] ping failed', e);
          return Response.json({ ok: false, error: 'db_unreachable' }, { status: 500 });
        }
      }
      // Connection status endpoint
      if (url.pathname === "/api/integrations/status") {
        const cookie = request.headers.get('Cookie') || '';
        const conn = parseInstagramCookie(cookie);
        const ttConn = parseTikTokCookie(cookie);
        const fbConn = parseFacebookCookie(cookie);
        const ytConn = parseYouTubeCookie(cookie);
        const pinConn = parsePinterestCookie(cookie);
        const thConn = parseThreadsCookie(cookie);
        const sid = getCookie(cookie, 'sid');
        // Prefer Hyperdrive-backed status if we have a session id and SQL client
        if (sid) {
          const sql = getSql(env);
          if (sql) {
            try {
              const igRow = await sqlQuerySocial(sql, sid, 'instagram');
              const ttRow = await sqlQuerySocial(sql, sid, 'tiktok');
              const fbRow = await sqlQuerySocial(sql, sid, 'facebook');
              const ytRow = await sqlQuerySocial(sql, sid, 'youtube');
              const pinRow = await sqlQuerySocial(sql, sid, 'pinterest');
              const thRow = await sqlQuerySocial(sql, sid, 'threads');
              return Response.json({
                instagram: igRow ? { connected: true, account: { id: igRow.providerId, username: igRow.name || null } } : (conn ? { connected: true, account: conn } : { connected: false }),
                tiktok: ttRow ? { connected: true, account: { id: ttRow.providerId, displayName: ttRow.name || null } } : (ttConn ? { connected: true, account: ttConn } : { connected: false }),
                facebook: fbRow ? { connected: true, account: { id: fbRow.providerId, name: fbRow.name || null } } : (fbConn ? { connected: true, account: fbConn } : { connected: false }),
                youtube: ytRow ? { connected: true, account: { id: ytRow.providerId, name: ytRow.name || null } } : (ytConn ? { connected: true, account: ytConn } : { connected: false }),
                pinterest: pinRow ? { connected: true, account: { id: pinRow.providerId, name: pinRow.name || null } } : (pinConn ? { connected: true, account: pinConn } : { connected: false }),
                threads: thRow ? { connected: true, account: { id: thRow.providerId, name: thRow.name || null } } : (thConn ? { connected: true, account: thConn } : { connected: false }),
              });
            } catch { void 0; }
          }
        }
        // Fallback to cookie-only status
        return Response.json({
          instagram: conn ? { connected: true, account: conn } : { connected: false },
          tiktok: ttConn ? { connected: true, account: ttConn } : { connected: false },
          facebook: fbConn ? { connected: true, account: fbConn } : { connected: false },
          youtube: ytConn ? { connected: true, account: ytConn } : { connected: false },
          pinterest: pinConn ? { connected: true, account: pinConn } : { connected: false },
          threads: thConn ? { connected: true, account: thConn } : { connected: false },
        });
      }

      // Instagram disconnect clears cookie
      if (url.pathname === "/api/integrations/instagram/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildInstagramCookie('', 0) });
        const cookie = request.headers.get('Cookie') || '';
        const sid = getCookie(cookie, 'sid');
        const sql = getSql(env);
        if (sid && sql) {
          try {
            await sqlDeleteSocial(sql, sid, 'instagram');
          } catch { void 0; }
        }
        // Best-effort: clear stored OAuth token server-side (do not block the response)
        if (sid) {
          const backendOrigin = getBackendOrigin(env, request);
          try {
            await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/instagram_oauth`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: null }),
            });
          } catch { void 0; }
        }
        return new Response(null, { status: 204, headers });
      }
      // TikTok disconnect clears cookie
      if (url.pathname === "/api/integrations/tiktok/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildTikTokCookie('', 0, request.url) });
        const cookie = request.headers.get('Cookie') || '';
        const sid = getCookie(cookie, 'sid');
        const sql = getSql(env);
        if (sid && sql) {
          try {
            await sqlDeleteSocial(sql, sid, 'tiktok');
          } catch { void 0; }
        }
        if (sid) {
          const backendOrigin = getBackendOrigin(env, request);
          try {
            await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/tiktok_oauth`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: null }),
            });
          } catch { void 0; }
        }
        // Clear temp oauth cookies too
        headers.append('Set-Cookie', buildTempCookie('tt_state', '', 0, request.url));
        headers.append('Set-Cookie', buildTempCookie('tt_verifier', '', 0, request.url));
        return new Response(null, { status: 204, headers });
      }

      // Facebook disconnect clears cookie
      if (url.pathname === "/api/integrations/facebook/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildFacebookCookie('', 0, request.url) });
        const cookie = request.headers.get('Cookie') || '';
        const sid = getCookie(cookie, 'sid');
        const sql = getSql(env);
        if (sid && sql) {
          try {
            await sqlDeleteSocial(sql, sid, 'facebook');
          } catch { void 0; }
        }
        if (sid) {
          const backendOrigin = getBackendOrigin(env, request);
          try {
            await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/facebook_oauth`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: null }),
            });
          } catch { void 0; }
        }
        return new Response(null, { status: 204, headers });
      }

      // YouTube disconnect clears cookie
      if (url.pathname === "/api/integrations/youtube/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildYouTubeCookie('', 0, request.url) });
        const cookie = request.headers.get('Cookie') || '';
        const sid = getCookie(cookie, 'sid');
        const sql = getSql(env);
        if (sid && sql) {
          try { await sqlDeleteSocial(sql, sid, 'youtube'); } catch { void 0; }
        }
        if (sid) {
          const backendOrigin = getBackendOrigin(env, request);
          try {
            await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/youtube_oauth`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: null }),
            });
          } catch { void 0; }
        }
        headers.append('Set-Cookie', buildTempCookie('yt_state', '', 0, request.url));
        headers.append('Set-Cookie', buildTempCookie('yt_verifier', '', 0, request.url));
        return new Response(null, { status: 204, headers });
      }

      // Pinterest disconnect clears cookie
      if (url.pathname === "/api/integrations/pinterest/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildPinterestCookie('', 0, request.url) });
        const cookie = request.headers.get('Cookie') || '';
        const sid = getCookie(cookie, 'sid');
        const sql = getSql(env);
        if (sid && sql) {
          try { await sqlDeleteSocial(sql, sid, 'pinterest'); } catch { void 0; }
        }
        if (sid) {
          const backendOrigin = getBackendOrigin(env, request);
          try {
            await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/pinterest_oauth`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: null }),
            });
          } catch { void 0; }
        }
        headers.append('Set-Cookie', buildTempCookie('pin_state', '', 0, request.url));
        return new Response(null, { status: 204, headers });
      }

      // Threads disconnect clears cookie
      if (url.pathname === "/api/integrations/threads/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildThreadsCookie('', 0, request.url) });
        const cookie = request.headers.get('Cookie') || '';
        const sid = getCookie(cookie, 'sid');
        const sql = getSql(env);
        if (sid && sql) {
          try { await sqlDeleteSocial(sql, sid, 'threads'); } catch { void 0; }
        }
        if (sid) {
          const backendOrigin = getBackendOrigin(env, request);
          try {
            await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/threads_oauth`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: null }),
            });
          } catch { void 0; }
        }
        headers.append('Set-Cookie', buildTempCookie('th_state', '', 0, request.url));
        return new Response(null, { status: 204, headers });
      }

      // Facebook OAuth start
      if (url.pathname === "/api/integrations/facebook/auth") {
        return startFacebookOAuth(request, env);
      }
      // Facebook OAuth callback
      if (url.pathname === "/api/integrations/facebook/callback") {
        return handleFacebookCallback(request, env);
      }
      // Facebook permissions debug (no secrets; reads stored oauth and calls Graph /me/permissions)
      if (url.pathname === "/api/integrations/facebook/permissions") {
        return handleFacebookPermissions(request, env);
      }
      // Facebook pages list (no secrets; returns ids/names/tasks/canPost only)
      if (url.pathname === "/api/integrations/facebook/pages") {
        return handleFacebookPages(request, env);
      }

      // YouTube OAuth start/callback
      if (url.pathname === "/api/integrations/youtube/auth") {
        return startYouTubeOAuth(request, env);
      }
      if (url.pathname === "/api/integrations/youtube/callback") {
        return handleYouTubeCallback(request, env);
      }

      // Pinterest OAuth start/callback
      if (url.pathname === "/api/integrations/pinterest/auth") {
        return startPinterestOAuth(request, env);
      }
      if (url.pathname === "/api/integrations/pinterest/callback") {
        return handlePinterestCallback(request, env);
      }

      // Threads OAuth start/callback
      if (url.pathname === "/api/integrations/threads/auth") {
        return startThreadsOAuth(request, env);
      }
      if (url.pathname === "/api/integrations/threads/callback") {
        return handleThreadsCallback(request, env);
      }

      // TikTok OAuth start
      if (url.pathname === "/api/integrations/tiktok/auth") {
        return startTikTokOAuth(request, env);
      }
      // TikTok OAuth callback
      if (url.pathname === "/api/integrations/tiktok/callback") {
        return handleTikTokCallback(request, env);
      }
      // TikTok scope status (no secrets)
      if (url.pathname === "/api/integrations/tiktok/scopes") {
        return handleTikTokScopes(request, env);
      }
      // Instagram OAuth start
      if (url.pathname === "/api/integrations/instagram/auth") {
        return startInstagramOAuth(request, env);
      }
      // Instagram OAuth callback
      if (url.pathname === "/api/integrations/instagram/callback") {
        return handleInstagramCallback(request, env);
      }

      // Suno: proxy to Go backend for generation/storage
      if (url.pathname === "/api/integrations/suno/generate") {
        return handleSunoGenerate(request, env);
      }
      if (url.pathname === "/api/integrations/suno/credits") {
        return handleSunoCredits(request, env);
      }
      if (url.pathname === "/api/integrations/suno/sync") {
        return handleSunoSync(request, env);
      }
      if (url.pathname === "/api/integrations/suno/tracks") {
        return handleSunoTracksList(request, env);
      }
      if (url.pathname === "/api/integrations/suno/store") {
        return handleSunoStore(request, env);
      }
      if (url.pathname === "/api/integrations/suno/api-key") {
        return handleSunoApiKey(request, env);
      }

      // Library: list cached social content for the current user
      if (url.pathname === "/api/library/items") {
        return handleLibraryItems(request, env);
      }
      if (url.pathname === "/api/library/sync") {
        return handleLibrarySync(request, env);
      }

      // Publishing: caption-only post fan-out (backend does per-provider posting)
      if (url.pathname === "/api/posts/publish") {
        return handlePostsPublish(request, env);
      }
      if (url.pathname === "/api/posts/publish/ws") {
        return handlePublishJobWs(request, env);
      }

      return Response.json({ ok: true });
    }

    // For all non-API requests, delegate to the static assets handler
    // This enables SPA routing (e.g., /dashboard, /features, /contact)
    if (env.ASSETS) {
      let res = await env.ASSETS.fetch(request);
      // Some configurations do not map "/" → "/index.html" automatically.
      // Also provide an SPA fallback for non-file routes.
      if (res.status === 404) {
        const accept = request.headers.get("Accept") || "";
        const looksLikeHtmlRoute =
          url.pathname === "/" ||
          (!url.pathname.includes(".") && accept.includes("text/html"));
        if (looksLikeHtmlRoute) {
          const indexUrl = new URL(request.url);
          indexUrl.pathname = "/index.html";
          res = await env.ASSETS.fetch(new Request(indexUrl, request));
        }
      }
      return res;
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleSunoGenerate(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	let body: unknown = null;
	try {
		if (request.headers.get('content-type')?.includes('application/json')) {
			body = await request.json();
		}
	} catch {
		body = null;
	}
	const bodyObj = asRecord(body);
	const prompt = getString(bodyObj?.['prompt']) ?? 'New song from Simple Social Thing';
	const model = getString(bodyObj?.['model']) ?? 'V4';

	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);
	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists in Go backend to satisfy FK on SunoTracks.user_id
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	const perUserKey = sid ? await fetchUserSunoKey(backendOrigin, sid) : null;
	const useMock = env.USE_MOCK_AUTH === 'true';
	if (!useMock && !perUserKey) {
		return new Response(JSON.stringify({ ok: false, error: 'missing_suno_api_key' }), { status: 400, headers });
	}
	const sunoApiKey = perUserKey || '';

	let audioUrl = '';
	let sunoTrackId = '';
	let ourTrackId: string | null = null;
	let taskId: string | null = null;

	if (useMock) {
		audioUrl = 'https://example.com/mock-suno-track.mp3';
		sunoTrackId = 'mock-suno-track-id';
	} else {
		// Suno API (3rd-party) supports async callbacks + polling.
		// Docs: https://docs.sunoapi.org/suno-api/generate-music
		const origin = new URL(request.url).origin;
		const callBackUrl = new URL('/callback/suno/music/', origin).toString();

		const sunoRes = await fetch('https://api.sunoapi.org/api/v1/generate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${sunoApiKey}`,
			},
			body: JSON.stringify({
				prompt,
				customMode: false,
				instrumental: false,
				model,
				callBackUrl,
			}),
		});
		if (!sunoRes.ok) {
			const errText = await sunoRes.text().catch(() => '');
			return Response.json({ ok: false, error: 'suno_generate_failed', status: sunoRes.status, details: errText }, { status: 502 });
		}

		// Response is { code, msg, data: { taskId } }
		const sunoStart: unknown = await sunoRes.json().catch(() => null);
		const startObj = asRecord(sunoStart);
		const dataObj = startObj ? asRecord(startObj['data']) : null;
		taskId = dataObj ? getString(dataObj['taskId']) : null;
		if (!taskId) {
			return Response.json({ ok: false, error: 'suno_missing_task_id', raw: sunoStart }, { status: 502 });
		}

		// Create a pending track row in backend (so UI can render it right away).
		try {
			const createRes = await fetch(`${backendOrigin}/api/suno/tasks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: sid, prompt, taskId, model }),
			});
			const createData: unknown = await createRes.json().catch(() => null);
			const createObj = asRecord(createData);
			ourTrackId = createObj && createObj['ok'] === true ? (getString(createObj['id']) ?? null) : null;
		} catch { void 0; }

		// Poll until SUCCESS and extract first track audioUrl/id
		let attempts = 30;
		let attemptNum = 0;
		let lastStatus: string | null = null;
		while (attempts-- > 0) {
			attemptNum++;
			const recRes = await fetch(`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
				headers: { 'Authorization': `Bearer ${sunoApiKey}`, 'Accept': 'application/json' },
			});
			const recData: unknown = await recRes.json().catch(() => null);
			const recObj = asRecord(recData);
			const recInner = recObj ? asRecord(recObj['data']) : null;
			lastStatus = getString(recInner?.['status']) ?? lastStatus;

			if (lastStatus === 'SUCCESS') {
				const respObj = recInner ? asRecord(recInner['response']) : null;
				const sunoDataArr = respObj ? (respObj['sunoData'] as unknown) : null;
				const first = Array.isArray(sunoDataArr) ? asRecord(sunoDataArr[0]) : null;
				audioUrl = getString(first?.['audioUrl']) ?? '';
				sunoTrackId = getString(first?.['id']) ?? '';
				if (audioUrl) break;
			}
			if (lastStatus === 'FAILED') {
				// Mark failed in backend if we created a row.
				if (ourTrackId) {
					try {
						await fetch(`${backendOrigin}/api/suno/tracks/${encodeURIComponent(ourTrackId)}`, {
							method: 'PUT',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ status: 'failed' }),
						});
					} catch { void 0; }
				}
				return Response.json({ ok: false, error: 'suno_generation_failed', taskId, details: recData }, { status: 502 });
			}

			// Exponential backoff: 2s, 4s, 6s, 8s, then 10s max
			const waitMs = Math.min(attemptNum * 2000, 10000);
			await new Promise((r) => setTimeout(r, waitMs));
		}

		if (!audioUrl) {
			return Response.json({ ok: false, error: 'suno_no_audio_after_poll', details: { taskId, lastStatus } }, { status: 504 });
		}
	}

	// Update the pending track row (or just return mock values).
	if (ourTrackId) {
		try {
			const upRes = await fetch(`${backendOrigin}/api/suno/tracks/${encodeURIComponent(ourTrackId)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sunoTrackId, audioUrl, status: 'completed' }),
			});
			if (!upRes.ok) {
				const t = await upRes.text().catch(() => '');
				return Response.json({ ok: false, error: 'suno_update_failed', status: upRes.status, details: t }, { status: 502, headers });
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return Response.json({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }, { status: 502, headers });
		}
	}

	return Response.json({ ok: true, suno: { audioUrl, sunoTrackId, taskId }, track: { id: ourTrackId } }, { headers });
}

async function handlePostsPublish(request: Request, env: Env): Promise<Response> {
  const headers = buildCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
    headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
  }

  const backendOrigin = getBackendOrigin(env, request);
  // Support both JSON and multipart/form-data (for media uploads).
  const contentType = request.headers.get('Content-Type') || request.headers.get('content-type') || '';
  let bodyBuf: ArrayBuffer | null = null;
  try {
    bodyBuf = await request.arrayBuffer();
  } catch {
    bodyBuf = null;
  }
  if (!bodyBuf || bodyBuf.byteLength === 0) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'missing_body' }), { status: 400, headers });
  }

  try {
    // Async publish: enqueue server job and return fast.
    const res = await fetch(`${backendOrigin}/api/social-posts/publish-async/user/${encodeURIComponent(sid)}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType || 'application/octet-stream', Accept: 'application/json' },
      body: bodyBuf,
    });
    const text = await res.text().catch(() => '');
    headers.set('Content-Type', 'application/json');
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'backend_error', status: res.status, body: text.slice(0, 1200) }), { status: 502, headers });
    }
    return new Response(text || JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
  }
}

async function handleFacebookWebhook(request: Request, env: Env): Promise<Response> {
  // GET: verification handshake (hub.challenge)
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode') || url.searchParams.get('hub_mode');
    const token = url.searchParams.get('hub.verify_token') || url.searchParams.get('hub_verify_token');
    const challenge = url.searchParams.get('hub.challenge') || url.searchParams.get('hub_challenge');

    if (mode === 'subscribe' && challenge) {
      const expected = (env.FACEBOOK_WEBHOOK_TOKEN || '').trim();
      if (!expected) {
        return new Response('missing_verify_token', { status: 500 });
      }
      if (token !== expected) {
        return new Response('forbidden', { status: 403 });
      }
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    // Friendly health response when hitting the endpoint without verification params.
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // POST: delivery
  if (request.method === 'POST') {
    const sig = request.headers.get('x-hub-signature-256') || request.headers.get('X-Hub-Signature-256');
    const secret = (env.INSTAGRAM_APP_SECRET || '').trim();

    // Read body once (we might need it for signature validation + logging).
    const raw = await request.arrayBuffer().catch(() => null);
    if (!raw) return new Response('bad_request', { status: 400 });

    // Optional signature validation (recommended).
    if (secret && sig && sig.startsWith('sha256=')) {
      const expectedHex = sig.slice('sha256='.length).trim();
      try {
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const mac = await crypto.subtle.sign('HMAC', key, raw);
        const macHex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (macHex !== expectedHex) {
          console.warn('[FBWebhook] invalid_signature');
          return new Response('forbidden', { status: 403 });
        }
      } catch (e) {
        console.warn('[FBWebhook] signature_validation_error', e);
        return new Response('forbidden', { status: 403 });
      }
    }

    // Acknowledge quickly; best-effort log payload for debugging.
    try {
      const text = new TextDecoder().decode(raw);
      console.log('[FBWebhook] event', text.slice(0, 4000));
    } catch { void 0; }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(null, { status: 405 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handlePublishJobWs(request: Request, env: Env): Promise<Response> {
  // WebSocket endpoint: streams publish job status updates by polling backend.
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket', { status: 400 });
  }
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId') || '';

  const headers = buildCorsHeaders(request);
  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    return new Response('unauthenticated', { status: 401, headers });
  }
  if (!jobId) {
    return new Response('missing_jobId', { status: 400, headers });
  }

  const backendOrigin = getBackendOrigin(env, request);

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const send = (obj: unknown) => {
    try { server.send(JSON.stringify(obj)); } catch { void 0; }
  };

  let closed = false;
  server.addEventListener('close', () => { closed = true; });
  server.addEventListener('error', () => { closed = true; });

  // Run in background: poll backend until terminal status.
  (async () => {
    let lastStatus: string | null = null;
    for (let attempt = 0; attempt < 600 && !closed; attempt++) { // up to 10 minutes
      try {
        const r = await fetch(`${backendOrigin}/api/social-posts/publish-jobs/${encodeURIComponent(jobId)}`, {
          headers: { Accept: 'application/json' },
        });
        const text = await r.text().catch(() => '');
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { ok: false, raw: text }; }

        // Guard: ensure job belongs to current sid.
        if (data && data.userId && String(data.userId) !== String(sid)) {
          send({ ok: false, error: 'forbidden' });
          try { server.close(1008, 'forbidden'); } catch { void 0; }
          return;
        }

        const status = data && typeof data.status === 'string' ? data.status : null;
        if (status && status !== lastStatus) {
          send({ ok: true, type: 'status', job: data });
          lastStatus = status;
        } else if (attempt % 5 === 0) {
          // periodic keepalive
          send({ ok: true, type: 'ping', t: Date.now() });
        }

        if (status === 'completed' || status === 'failed') {
          send({ ok: true, type: 'done', job: data });
          try { server.close(1000, 'done'); } catch { void 0; }
          return;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (attempt % 5 === 0) send({ ok: false, error: 'poll_failed', details: { message } });
      }
      await sleep(1000);
    }
    try { server.close(1000, 'timeout'); } catch { void 0; }
  })();

  return new Response(null, { status: 101, webSocket: client, headers });
}

async function handleSunoCredits(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);

	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== 'GET') return new Response(null, { status: 405, headers });

	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	const perUserKey = await fetchUserSunoKey(backendOrigin, sid);
	const sunoApiKey = perUserKey || '';
	if (!sunoApiKey) {
		return new Response(JSON.stringify({ ok: false, error: 'missing_suno_api_key' }), { status: 400, headers });
	}

	try {
		const res = await fetch('https://api.sunoapi.org/api/v1/generate/credit', {
			headers: {
				'Accept': 'application/json',
				'Authorization': `Bearer ${sunoApiKey}`,
			},
		});
		const rawText = await res.text().catch(() => '');
		logLarge('[Suno][Credits][Response]', `status=${res.status} body=${rawText}`);

		let data: unknown = null;
		try {
			data = rawText ? JSON.parse(rawText) : null;
		} catch {
			data = rawText;
		}

		if (!res.ok) {
			return new Response(JSON.stringify({ ok: false, error: 'suno_credits_failed', status: res.status, details: data }), { status: 502, headers });
		}

		const availableCredits = extractCreditsNumber(data);
		console.log('[Suno][Credits][Parsed]', JSON.stringify({ availableCredits }).slice(0, 500));

		// Cache credits in the DB (per-user settings) to speed up initial render.
		if (typeof availableCredits === 'number' && Number.isFinite(availableCredits)) {
			try {
				await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/suno_credits`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ value: { availableCredits, fetchedAt: new Date().toISOString() } }),
				});
			} catch { void 0; }
		}

		headers.set('Content-Type', 'application/json');
		return new Response(JSON.stringify({ ok: true, credits: data, availableCredits }), { status: 200, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: 'suno_unreachable', details: { message } }), { status: 502, headers });
	}
}

async function handleUserSettingsBundle(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);

	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== 'GET') return new Response(null, { status: 405, headers });

	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	try {
		const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}`, {
			headers: { 'Accept': 'application/json' },
		});
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			console.error('[UserSettingsBundle] backend non-2xx', { backendOrigin, status: res.status, body: text.slice(0, 800) });
			return new Response(JSON.stringify({ ok: false, error: 'settings_fetch_failed', status: res.status }), { status: 502, headers });
		}
		let parsed: unknown = null;
		try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
		const obj = asRecord(parsed);
		const data = obj ? asRecord(obj['data']) : null;

		// Sanitize: do not persist secrets in browser cache.
		if (data && 'suno_api_key' in data) {
			delete (data as Record<string, unknown>)['suno_api_key'];
		}
		if (data && 'instagram_oauth' in data) {
			delete (data as Record<string, unknown>)['instagram_oauth'];
		}
		if (data && 'tiktok_oauth' in data) {
			delete (data as Record<string, unknown>)['tiktok_oauth'];
		}
		if (data && 'facebook_oauth' in data) {
			delete (data as Record<string, unknown>)['facebook_oauth'];
		}
		if (data && 'youtube_oauth' in data) {
			delete (data as Record<string, unknown>)['youtube_oauth'];
		}
		if (data && 'pinterest_oauth' in data) {
			delete (data as Record<string, unknown>)['pinterest_oauth'];
		}
		if (data && 'threads_oauth' in data) {
			delete (data as Record<string, unknown>)['threads_oauth'];
		}

		headers.set('Content-Type', 'application/json');
		return new Response(JSON.stringify({ ok: true, data: data ?? {} }), { status: 200, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[UserSettingsBundle] backend unreachable', { backendOrigin, message });
		return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
	}
}

async function handleLibraryItems(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);

	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== 'GET') return new Response(null, { status: 405, headers });

	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists in backend
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	try {
		const url = new URL(request.url);
		const qs = url.search || '';
		const res = await fetch(`${backendOrigin}/api/social-libraries/user/${encodeURIComponent(sid)}${qs}`, {
			headers: { 'Accept': 'application/json' },
		});
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			console.error('[LibraryItems] backend non-2xx', { backendOrigin, status: res.status, body: text.slice(0, 800) });
			return new Response(JSON.stringify({ ok: false, error: 'list_failed', status: res.status, details: text.slice(0, 2000) }), { status: 502, headers });
		}
		headers.set('Content-Type', 'application/json');
		return new Response(text || '[]', { status: 200, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[LibraryItems] backend unreachable', { backendOrigin, message });
		return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
	}
}

async function handleLibrarySync(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);

	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== 'POST') return new Response(null, { status: 405, headers });

	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	try {
		const res = await fetch(`${backendOrigin}/api/social-libraries/sync/user/${encodeURIComponent(sid)}`, {
			method: 'POST',
			headers: { 'Accept': 'application/json' },
		});
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			console.error('[LibrarySync] backend non-2xx', { backendOrigin, status: res.status, body: text.slice(0, 800) });
			return new Response(JSON.stringify({ ok: false, error: 'sync_failed', status: res.status, details: text.slice(0, 2000) }), { status: 502, headers });
		}
		headers.set('Content-Type', 'application/json');
		return new Response(text || '{"ok":true}', { status: 200, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[LibrarySync] backend unreachable', { backendOrigin, message });
		return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
	}
}

async function handleSunoSync(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);

	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== 'POST') return new Response(null, { status: 405, headers });

	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	const perUserKey = await fetchUserSunoKey(backendOrigin, sid);
	const sunoApiKey = perUserKey || '';
	if (!sunoApiKey) {
		return new Response(JSON.stringify({ ok: false, error: 'missing_suno_api_key' }), { status: 400, headers });
	}

	// Get our local view of tracks first (limit to keep requests bounded).
	let tracks: unknown = null;
	try {
		const r = await fetch(`${backendOrigin}/api/suno/tracks/user/${encodeURIComponent(sid)}`, { headers: { 'Accept': 'application/json' } });
		tracks = await r.json().catch(() => null);
	} catch {
		tracks = null;
	}
	if (!Array.isArray(tracks)) {
		return new Response(JSON.stringify({ ok: false, error: 'tracks_unavailable' }), { status: 502, headers });
	}

	const pending = tracks
		.map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : null))
		.filter(Boolean)
		.filter((t) => {
			const st = typeof t!.status === 'string' ? t!.status.toLowerCase() : '';
			return st !== 'completed' && st !== 'failed';
		})
		.slice(0, 20);

	let checked = 0;
	let updated = 0;
	const updates: Array<{ id: string; taskId: string; status: string }> = [];

	for (const t of pending) {
		const id = typeof t!.id === 'string' ? t!.id : '';
		const taskId = typeof t!.taskId === 'string' ? t!.taskId : '';
		if (!id || !taskId) continue;
		checked++;
		try {
			// Suno docs: "Get Music Generation Details" – use this endpoint to check status instead of waiting for callbacks.
			// https://docs.sunoapi.org/suno-api/get-music-generation-details
			const recRes = await fetch(`https://api.sunoapi.org/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
				headers: { 'Authorization': `Bearer ${sunoApiKey}`, 'Accept': 'application/json' },
			});
			const recData: unknown = await recRes.json().catch(() => null);
			const recObj = asRecord(recData);
			const dataObj = recObj ? asRecord(recObj['data']) : null;
			const providerStatus = getString(dataObj?.['status']) ?? 'PENDING';

			let localStatus = 'pending';
			if (providerStatus === 'SUCCESS') localStatus = 'completed';
			if (providerStatus.endsWith('_FAILED') || providerStatus === 'FAILED' || providerStatus === 'CALLBACK_EXCEPTION') localStatus = 'failed';

			let audioUrl = '';
			let sunoTrackId = '';
			if (localStatus === 'completed') {
				const respObj = dataObj ? asRecord(dataObj['response']) : null;
				const sunoDataArr = respObj ? (respObj['sunoData'] as unknown) : null;
				const first = Array.isArray(sunoDataArr) ? asRecord(sunoDataArr[0]) : null;
				audioUrl = getString(first?.['audioUrl']) ?? '';
				sunoTrackId = getString(first?.['id']) ?? '';
			}

			// Update backend row.
			await fetch(`${backendOrigin}/api/suno/tracks/${encodeURIComponent(id)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: localStatus,
					audioUrl: audioUrl || undefined,
					sunoTrackId: sunoTrackId || undefined,
				}),
			});
			updated++;
			updates.push({ id, taskId, status: localStatus });
		} catch { void 0; }
	}

	headers.set('Content-Type', 'application/json');
	return new Response(JSON.stringify({ ok: true, checked, updated, updates }), { status: 200, headers });
}

async function handleSunoCallback(request: Request, env: Env): Promise<Response> {
	// Suno callbacks are provider → our endpoint. Forward to Go backend so it can update DB / download audio.
	// Docs: https://docs.sunoapi.org/suno-api/generate-music (Music Generation Callbacks).
	if (request.method !== 'POST') return new Response(null, { status: 405 });
	const backendOrigin = getBackendOrigin(env, request);
	const body = await request.text().catch(() => '');
	const contentType = request.headers.get('Content-Type') || 'application/json';
	try {
		const res = await fetch(`${backendOrigin}/callback/suno/music`, {
			method: 'POST',
			headers: { 'Content-Type': contentType },
			body,
		});
		if (!res.ok) {
			const txt = await res.text().catch(() => '');
			console.error('[Suno][Callback] backend non-2xx', res.status, txt.slice(0, 2000));
			// Still return 200 to provider to avoid retries storm.
		}
	} catch (e) {
		console.error('[Suno][Callback] backend unreachable', e);
		// Still return 200 to provider to avoid retries storm.
	}
	return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

async function handleSunoStore(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	return fetch(`${backendOrigin}/api/suno/store`, {
		method: request.method,
		headers: { 'Content-Type': 'application/json' },
		body: await request.text(),
	});
}

async function handleSunoTracksList(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);

	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== 'GET') return new Response(null, { status: 405, headers });

	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}

	try {
		const res = await fetch(`${backendOrigin}/api/suno/tracks/user/${encodeURIComponent(sid)}`, {
			headers: { 'Accept': 'application/json' },
		});
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			return new Response(JSON.stringify({ ok: false, error: 'list_failed', status: res.status, details: text.slice(0, 2000) }), { status: 502, headers });
		}
		// passthrough array JSON
		headers.set('Content-Type', 'application/json');
		return new Response(text || '[]', { status: 200, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
	}
}

async function handleSunoApiKey(request: Request, env: Env): Promise<Response> {
	const backendOrigin = getBackendOrigin(env, request);
	const cookie = request.headers.get('Cookie') || '';
	let sid = getCookie(cookie, 'sid');
	// Local dev helper: if no sid, issue one so the user can save their key
	const requestUrl = request.url;
	const isLocal = new URL(requestUrl).hostname === 'localhost' || new URL(requestUrl).hostname === '127.0.0.1';
	const headers = buildCorsHeaders(request);
	if (request.method === 'OPTIONS') {
		headers.set('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
		headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
		return new Response(null, { status: 204, headers });
	}
	if (!sid && isLocal) {
		sid = crypto.randomUUID();
		headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, requestUrl));
		// ensure user exists in Go backend to satisfy FK in UserSettings
		try {
			await fetch(`${backendOrigin}/api/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
			});
		} catch { void 0; }
	}
	if (!sid) {
		return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
	}
	if (request.method === 'GET') {
		try {
			const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/suno_api_key`);
			if (res.status === 404) {
				return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers });
			}
			const data: unknown = await res.json().catch(() => null);
			const obj = asRecord(data);
			const value = obj ? obj['value'] : null;
			return new Response(JSON.stringify({ ok: true, value: value ?? null }), { status: 200, headers });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new Response(
				JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }),
				{ status: 502, headers }
			);
		}
	}
	if (request.method === 'PUT') {
		const bodyText = await request.text();
		// expect { apiKey: string }
		let parsed: unknown = null;
		try { parsed = JSON.parse(bodyText || '{}'); } catch { parsed = null; }
		const parsedObj = asRecord(parsed);
		const apiKey = getString(parsedObj?.['apiKey']);
		try {
			const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/suno_api_key`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: { apiKey } }),
			});
			const data: unknown = await res.json().catch(() => null);
			const dataObj = asRecord(data) ?? {};
			if (!res.ok) {
				return new Response(JSON.stringify({ ok: false, error: 'save_failed', backend: dataObj }), { status: 500, headers });
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new Response(
				JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }),
				{ status: 502, headers }
			);
		}
	}
	return new Response(null, { status: 405, headers });
}

function buildCorsHeaders(request: Request): Headers {
	const origin = request.headers.get('Origin');
	const headers = new Headers();
	if (origin) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Vary', 'Origin');
		headers.set('Access-Control-Allow-Credentials', 'true');
	} else {
		headers.set('Access-Control-Allow-Origin', '*');
	}
	return headers;
}

async function fetchUserSunoKey(backendOrigin: string, userId: string): Promise<string | null> {
	try {
		const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(userId)}/suno_api_key`);
		if (!res.ok) return null;
		const data: unknown = await res.json().catch(() => null);
		const obj = asRecord(data);
		const valueObj = obj ? asRecord(obj['value']) : null;
		const apiKey = valueObj ? getString(valueObj['apiKey']) : null;
		if (apiKey) return apiKey;
		return null;
	} catch {
		return null;
	}
}

function getBackendOrigin(env: Env, request: Request): string {
	const normalize = (raw: string): string => {
		let v = (raw || '').trim().replace(/\/+$/g, '');
		if (!v) return v;
		// If the scheme is missing, infer it.
		if (!/^https?:\/\//i.test(v)) {
			// Common accidental config: BACKEND_ORIGIN=api-simple.truvis.co (no scheme)
			// For localhost, default to http; otherwise default to request scheme (usually https).
			if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(v)) {
				v = `http://${v}`;
			} else {
				const proto = new URL(request.url).protocol || 'https:';
				v = `${proto}//${v}`;
			}
		}
		return v;
	};
	if (env.BACKEND_ORIGIN && env.BACKEND_ORIGIN.trim() !== '') return normalize(env.BACKEND_ORIGIN);
	const url = new URL(request.url);
	const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (isLocal) {
		return 'http://localhost:18911';
	}
	// production heuristic: frontend is on `simple.<domain>` and backend lives on `api-simple.<domain>`
	if (url.hostname === 'simple.truvis.co') {
		return 'https://api-simple.truvis.co';
	}
	if (url.hostname.startsWith('simple.')) {
		return `${url.protocol}//api-${url.hostname}`;
	}
	// fallback: same origin
	return url.origin;
}

async function startInstagramOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/instagram/callback', url.origin).toString();

  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'instagram_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
  }

  const scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_manage_metadata',
    'instagram_manage_messages',
    'instagram_manage_comments',
    'business_management',
    'pages_read_engagement',
    // Required for publishing via Instagram Content Publishing API
    'instagram_content_publish',
  ].join(',');

  const state = crypto.randomUUID();
  const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
  authUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID!);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

async function handleInstagramCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/instagram/callback', url.origin).toString();

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const useMock = env.USE_MOCK_AUTH === 'true' || !env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET;
  if (useMock) {
    const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'instagram', account: { id: 'mock-ig-123', name: 'Mock Instagram' } }));
    return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
  }

  if (error) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error }));
    return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
  }
  if (!code) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'missing_code' }));
    return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
  }

  // Exchange code for short-lived token
  const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID!);
  tokenUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET!);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  try {
    // Step 1: Exchange code for short-lived token
    const tokenRes = await fetch(tokenUrl.toString(), { headers: { 'Accept': 'application/json' }});
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      console.error('[IG] token_exchange_failed', tokenRes.status, errText);
      const data = encodeURIComponent(JSON.stringify({ success: false, error: 'token_exchange_failed', status: tokenRes.status }));
      return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
    }
    const short = (await tokenRes.json()) as { access_token: string; token_type?: string; expires_in?: number };

    // Step 1b (recommended): exchange for long-lived user token
    type FbExchangeResponse = { access_token: string; token_type?: string; expires_in?: number };
    let accessToken = short.access_token;
    let tokenType = short.token_type || 'bearer';
    let expiresIn = short.expires_in || 0;
    let rawTokenPayload: unknown = { short };
    try {
      const longUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
      longUrl.searchParams.set('grant_type', 'fb_exchange_token');
      longUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID!);
      longUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET!);
      longUrl.searchParams.set('fb_exchange_token', short.access_token);
      const longRes = await fetch(longUrl.toString(), { headers: { 'Accept': 'application/json' }});
      if (longRes.ok) {
        const long = (await longRes.json()) as FbExchangeResponse;
        accessToken = long.access_token;
        tokenType = long.token_type || tokenType;
        expiresIn = typeof long.expires_in === 'number' ? long.expires_in : expiresIn;
        rawTokenPayload = { short, long };
      } else {
        const longErr = await longRes.text().catch(() => '');
        rawTokenPayload = { short, longError: { status: longRes.status, body: longErr } };
      }
    } catch (e) {
      rawTokenPayload = { short, longError: { message: e instanceof Error ? e.message : String(e) } };
    }

    // Step 2: Get user pages and find linked Instagram business account
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=name,instagram_business_account&access_token=${encodeURIComponent(accessToken)}`);
    if (!pagesRes.ok) {
      const errText = await pagesRes.text().catch(() => '');
      console.error('[IG] pages_fetch_failed', pagesRes.status, errText);
      const data = encodeURIComponent(JSON.stringify({ success: false, error: 'pages_fetch_failed', status: pagesRes.status }));
      return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
    }
    const pages = (await pagesRes.json()) as { data?: Array<{ id: string; name: string; instagram_business_account?: { id: string } }> };
    const summary = (pages.data || []).slice(0, 8).map(p => ({ id: p.id, name: p.name, hasIg: !!p.instagram_business_account?.id }));
    console.log('[IG] pages summary', JSON.stringify(summary));
    const withIg = pages.data?.find(p => p.instagram_business_account?.id);
    if (!withIg) {
      const data = encodeURIComponent(JSON.stringify({ success: false, error: 'no_instagram_business_account_linked', pages: summary }));
      return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
    }

    // Step 3: Fetch IG username for display
    const igId = withIg.instagram_business_account!.id;
    const igRes = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(igId)}?fields=username&access_token=${encodeURIComponent(accessToken)}`);
    const ig = igRes.ok ? ((await igRes.json()) as { username?: string }) : {};

    // Persist connection via Hyperdrive SQL when available (falls back to no-op on DB)
    const sql = getSql(env);
    if (sql && sid) {
      try {
        await sqlUpsertSocial(sql, {
          userId: sid,
          provider: 'instagram',
          providerId: igId,
          name: ig.username || null,
        });
      } catch (e) {
        console.error('[DB] sqlUpsertSocial (instagram) failed', e);
      }
    }

    // Persist OAuth token to our backend so the server can later import Instagram content into SocialLibraries.
    {
      const backendOrigin = getBackendOrigin(env, request);
      const obtainedAt = new Date().toISOString();
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
      try {
        // ensure user exists (best-effort)
        await fetch(`${backendOrigin}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sid, email: '', name: 'User', imageUrl: null }),
        });
      } catch { void 0; }
      try {
        await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/instagram_oauth`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            value: {
              accessToken,
              tokenType,
              expiresIn,
              obtainedAt,
              expiresAt,
              pageId: withIg.id,
              igBusinessId: igId,
              username: ig.username || null,
              raw: rawTokenPayload,
            },
          }),
        });
      } catch (e) {
        console.error('[IG] failed to persist instagram_oauth to backend', e);
      }
    }

    // Set a cookie with minimal IG connection info and redirect back to client
    const cookieValue = JSON.stringify({ id: igId, username: ig.username || null });
    const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'instagram', account: { id: igId, username: ig.username || null } }));
    const location = `${clientUrl}/integrations?instagram=${data}`;
    const headers = new Headers();
    headers.set('Location', location);
    headers.append('Set-Cookie', buildInstagramCookie(cookieValue, 60 * 60 * 24 * 30, request.url)); // 30 days
    return new Response(null, { status: 302, headers });
  } catch (e) {
    console.error('[IG] internal_error', e);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'internal_error' }));
    return Response.redirect(`${clientUrl}/integrations?instagram=${data}`, 302);
  }
}

async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Determine client URL dynamically
  // For local dev: worker is on :18912, frontend is on :18910
  // For production: both are on the same domain
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost
    ? `http://localhost:18910`
    : url.origin.replace(/\/api.*$/, '');

  // The redirect_uri must match what was sent to Google in the auth request
  // In dev: frontend sends localhost:18910, in prod: same as url.origin
  const redirectUri = isLocalhost
    ? `${clientUrl}/api/auth/google/callback`
    : new URL('/api/auth/google/callback', url.origin).toString();

  // Handle OAuth errors
  if (error) {
    return Response.json({
      error: error,
      error_description: url.searchParams.get('error_description')
    }, { status: 400 });
  }

  // Validate required parameters
  if (!code) {
    return Response.json({
      error: 'missing_code',
      error_description: 'Authorization code is required'
    }, { status: 400 });
  }

  try {
    // For local development, return mock data if external APIs are not accessible
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const useMock = isLocalhost && env.USE_MOCK_AUTH === 'true';

    if (useMock) {
      // Mock successful OAuth response for local development
      const mockUserData = {
        id: 'mock-google-id-123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://via.placeholder.com/150',
      };
      await persistUser(env, {
        id: mockUserData.id,
        email: mockUserData.email,
        name: mockUserData.name,
        imageUrl: mockUserData.picture,
      });
      await persistSocialConnection(env, {
        userId: mockUserData.id,
        provider: 'google',
        providerId: mockUserData.id,
        email: mockUserData.email,
        name: mockUserData.name,
      });
      const userDataParam = encodeURIComponent(JSON.stringify({
        success: true,
        user: {
          id: mockUserData.id,
          email: mockUserData.email,
          name: mockUserData.name,
          imageUrl: mockUserData.picture,
          accessToken: 'mock-access-token',
        },
      }));

      return Response.redirect(`${clientUrl}?oauth=${userDataParam}`, 302);
    }

    // Exchange authorization code for access token (production)
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return Response.json({
        error: 'token_exchange_failed',
        error_description: 'Failed to exchange authorization code for token'
      }, { status: 500 });
    }

    const tokenData: GoogleTokenResponse = await tokenResponse.json();

    // Get user information using the access token
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!userResponse.ok) {
      console.error('User info fetch failed:', userResponse.statusText);
      return Response.json({
        error: 'user_info_failed',
        error_description: 'Failed to fetch user information'
      }, { status: 500 });
    }

    const userData: GoogleUserInfo = await userResponse.json();

    // Create user data for frontend
    const frontendUserData = {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      imageUrl: userData.picture,
      accessToken: tokenData.access_token,
    };
    console.log('Google picture:', userData.picture)

    // Upsert user into Postgres via Hyperdrive if available
    {
      const sql = getSql(env);
      if (sql) {
        let canonicalUserId = frontendUserData.id;
        try {
          canonicalUserId = await sqlUpsertUser(sql, {
            id: frontendUserData.id,
            email: frontendUserData.email,
            name: frontendUserData.name,
            imageUrl: frontendUserData.imageUrl || null,
          });
        } catch (e) {
          console.error('[DB] sqlUpsertUser failed', e);
        }
        try {
          // Also record Google connection (optional)
          await sqlUpsertSocial(sql, {
            userId: canonicalUserId,
            provider: 'google',
            providerId: userData.id,
            email: frontendUserData.email,
            name: frontendUserData.name,
          });
        } catch (e) {
          console.error('[DB] sqlUpsertSocial (google) failed', e);
        }
      }
    }

    // Redirect back to frontend with user data in URL parameter and set session cookie (sid)
    const userDataParam = encodeURIComponent(JSON.stringify({ success: true, user: frontendUserData }));
    const headers = new Headers();
    headers.set('Location', `${clientUrl}?oauth=${userDataParam}`);
    // Prefer canonical DB user id in the session cookie to satisfy FK constraints later
    const sql = getSql(env);
    let sidValue = frontendUserData.id;
    if (sql) {
      try {
        sidValue = await sqlUpsertUser(sql, {
          id: frontendUserData.id,
          email: frontendUserData.email,
          name: frontendUserData.name,
          imageUrl: frontendUserData.imageUrl || null,
        });
      } catch (e) {
        console.error('[DB] sqlUpsertUser for sid failed', e);
      }
    }
    headers.append('Set-Cookie', buildSidCookie(sidValue, 60 * 60 * 24 * 30, request.url));
    return new Response(null, { status: 302, headers });

  } catch (error) {
    console.error('OAuth callback error:', error);
    return Response.json({
      error: 'internal_error',
      error_description: 'An internal error occurred during OAuth processing'
    }, { status: 500 });
  }
}

async function startTikTokOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/tiktok/callback', url.origin).toString();

  const clientKey = (env.TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = (env.TIKTOK_CLIENT_SECRET || '').trim();
  if (!clientKey || !clientSecret) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'tiktok_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  let sid = getCookie(cookieHeader, 'sid');
  const headers = new Headers();

  // local dev helper: create sid if missing, so callback can persist tokens
  if (!sid && isLocalhost) {
    sid = crypto.randomUUID();
    headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, request.url));
    const backendOrigin = getBackendOrigin(env, request);
    try {
      await fetch(`${backendOrigin}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
      });
    } catch { void 0; }
  }
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  const state = crypto.randomUUID();
  const verifier = base64UrlRandom(32);
  const challenge = await pkceChallengeS256(verifier);

  headers.append('Set-Cookie', buildTempCookie('tt_state', state, 10 * 60, request.url));
  headers.append('Set-Cookie', buildTempCookie('tt_verifier', verifier, 10 * 60, request.url));

  // Scopes:
  // - default: Login Kit minimal (`user.info.basic`)
  // - optional: request extra scopes via query string (e.g. `?scope=video.list`)
  // Docs: https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens
  const requested = (url.searchParams.get('scope') || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  // Supported scopes in our app:
  // - user.info.basic (Login Kit)
  // - video.list (import)
  // - video.publish / video.upload (posting; requires Content Posting API approval)
  const allow = new Set(['user.info.basic', 'video.list', 'video.publish', 'video.upload']);
  const finalScopes = new Set<string>(['user.info.basic']);
  for (const s of requested) {
    if (allow.has(s)) finalScopes.add(s);
  }
  // TikTok follows OAuth2 semantics: multiple scopes are space-delimited.
  // Using comma-delimited scopes can cause TikTok to treat the entire value as a single unknown scope,
  // returning `error=invalid_scope`.
  const scopes = Array.from(finalScopes).join(' ');

  headers.append('Set-Cookie', buildTempCookie('tt_scopes', scopes, 10 * 60, request.url));
  const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
  authUrl.searchParams.set('client_key', clientKey);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  headers.set('Location', authUrl.toString());
  return new Response(null, { status: 302, headers });
}

async function handleTikTokCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/tiktok/callback', url.origin).toString();

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error, errorDescription }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }
  if (!code) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'missing_code' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  const clientKey = (env.TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = (env.TIKTOK_CLIENT_SECRET || '').trim();
  if (!clientKey || !clientSecret) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'tiktok_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  const stateCookie = getCookie(cookieHeader, 'tt_state');
  const verifier = getCookie(cookieHeader, 'tt_verifier');
  const requestedScopes = getCookie(cookieHeader, 'tt_scopes') || null;
  const state = url.searchParams.get('state');

  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }
  if (!stateCookie || !state || stateCookie !== state || !verifier) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_state' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  // Exchange code for token
  const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  const tokenText = await tokenRes.text().catch(() => '');
  let tokenJson: unknown = null;
  try { tokenJson = tokenText ? JSON.parse(tokenText) : null; } catch { tokenJson = null; }
  const tokenObj = asRecord(tokenJson);

  if (!tokenRes.ok) {
    console.error('[TT] token_exchange_failed', tokenRes.status, tokenText);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'token_exchange_failed', status: tokenRes.status }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  // TikTok v2 token response shape: { access_token, expires_in, open_id, refresh_token, refresh_expires_in, scope, token_type }
  const accessToken = getString(tokenObj?.['access_token']) || '';
  const openId = getString(tokenObj?.['open_id']) || '';
  const scope = getString(tokenObj?.['scope']) || '';
  const tokenType = getString(tokenObj?.['token_type']) || 'bearer';
  const expiresIn = getNumber(tokenObj?.['expires_in']) || 0;
  const refreshToken = getString(tokenObj?.['refresh_token']) || null;
  const refreshExpiresIn = getNumber(tokenObj?.['refresh_expires_in']) || null;

  if (!accessToken || !openId) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_token_response' }));
    return Response.redirect(`${clientUrl}/integrations?tiktok=${data}`, 302);
  }

  // Fetch user display name (best-effort)
  let displayName: string | null = null;
  try {
    const userInfoRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
    });
    const userText = await userInfoRes.text().catch(() => '');
    if (userInfoRes.ok) {
      const userJson: unknown = userText ? JSON.parse(userText) : null;
      const uObj = asRecord(userJson);
      const dataObj = uObj ? asRecord(uObj['data']) : null;
      const userObj = dataObj ? asRecord(dataObj['user']) : null;
      displayName = getString(userObj?.['display_name']);
    } else {
      console.warn('[TT] user_info_failed', userInfoRes.status, userText);
    }
  } catch (e) {
    console.warn('[TT] user_info_error', e);
  }

  // Persist SocialConnections (Hyperdrive) if available
  const sql = getSql(env);
  if (sql) {
    try {
      await sqlUpsertSocial(sql, {
        userId: sid,
        provider: 'tiktok',
        providerId: openId,
        name: displayName,
      });
    } catch (e) {
      console.error('[DB] sqlUpsertSocial (tiktok) failed', e);
    }
  }

  // Persist OAuth token in backend UserSettings for later use (posting, library import, webhooks)
  const backendOrigin = getBackendOrigin(env, request);
  const obtainedAt = new Date().toISOString();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  try {
    // Ensure the user row exists in the Go backend DB (avoid FK failures for UserSettings).
    // Safe because backend CreateUser is now "non-clobbering" for empty fields.
    try {
      await fetch(`${backendOrigin}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid, email: '', name: displayName || 'TikTok User', imageUrl: null }),
      });
    } catch (e) {
      console.warn('[TT] ensure user failed', e);
    }

    const settingsRes = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/tiktok_oauth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: {
          accessToken,
          tokenType,
          openId,
          scope,
          requestedScopes,
          expiresIn,
          obtainedAt,
          expiresAt,
          refreshToken,
          refreshExpiresIn,
          raw: tokenObj ?? tokenJson,
        },
      }),
    });
    if (!settingsRes.ok) {
      const errText = await settingsRes.text().catch(() => '');
      console.error('[TT] persist tiktok_oauth failed', settingsRes.status, errText.slice(0, 1200));
    }
  } catch (e) {
    console.error('[TT] failed to persist tiktok_oauth to backend', e);
  }

  // Set minimal cookie so UI can show status even if DB status fetch fails
  const headers = new Headers();
  const cookieValue = JSON.stringify({ id: openId, displayName });
  headers.append('Set-Cookie', buildTikTokCookie(cookieValue, 60 * 60 * 24 * 30, request.url));
  // Clear temp cookies
  headers.append('Set-Cookie', buildTempCookie('tt_state', '', 0, request.url));
  headers.append('Set-Cookie', buildTempCookie('tt_verifier', '', 0, request.url));
  headers.append('Set-Cookie', buildTempCookie('tt_scopes', '', 0, request.url));

  const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'tiktok', account: { id: openId, displayName } }));
  headers.set('Location', `${clientUrl}/integrations?tiktok=${data}`);
  return new Response(null, { status: 302, headers });
}

async function handleTikTokScopes(request: Request, env: Env): Promise<Response> {
  const headers = buildCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
  }

  const backendOrigin = getBackendOrigin(env, request);
  try {
    const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/tiktok_oauth`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ ok: true, scope: null, hasVideoList: false }), { status: 200, headers });
    }
    const data: unknown = await res.json().catch(() => null);
    const obj = asRecord(data);
    const valueObj = obj ? asRecord(obj['value']) : null;
    const scope = getString(valueObj?.['scope']);
    const requestedScopes = getString(valueObj?.['requestedScopes']);
    const norm = (scope || '').replace(/\s+/g, ',');
    const hasVideoList = norm.split(',').map(s => s.trim()).includes('video.list');
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true, scope: scope ?? null, requestedScopes: requestedScopes ?? null, hasVideoList }), { status: 200, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
  }
}

async function startFacebookOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/facebook/callback', url.origin).toString();

  // Reuse Meta app credentials (same app for Instagram/Facebook).
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'facebook_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  let sid = getCookie(cookieHeader, 'sid');
  const headers = new Headers();

  // local dev helper: create sid if missing, so callback can persist tokens
  if (!sid && isLocalhost) {
    sid = crypto.randomUUID();
    headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, request.url));
    const backendOrigin = getBackendOrigin(env, request);
    try {
      await fetch(`${backendOrigin}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
      });
    } catch { void 0; }
  }
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }

  const state = crypto.randomUUID();
  headers.append('Set-Cookie', buildTempCookie('fb_state', state, 10 * 60, request.url));

  // Scopes needed for reading Page posts.
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    // Required to publish content as a Page via /{page-id}/feed
    'pages_manage_posts',
  ].join(',');

  const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
  authUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  headers.set('Location', authUrl.toString());
  return new Response(null, { status: 302, headers });
}

async function handleFacebookCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/facebook/callback', url.origin).toString();

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error, errorDescription }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }
  if (!code) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'missing_code' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'facebook_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  const stateCookie = getCookie(cookieHeader, 'fb_state');
  const state = url.searchParams.get('state');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }
  if (!stateCookie || !state || stateCookie !== state) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_state' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }

  // Exchange code for short-lived token
  const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID);
  tokenUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const tokenRes = await fetch(tokenUrl.toString(), { headers: { Accept: 'application/json' } });
  const tokenText = await tokenRes.text().catch(() => '');
  if (!tokenRes.ok) {
    console.error('[FB] token_exchange_failed', tokenRes.status, tokenText);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'token_exchange_failed', status: tokenRes.status }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }
  const short: any = tokenText ? JSON.parse(tokenText) : null;
  const shortToken = typeof short?.access_token === 'string' ? short.access_token : '';
  if (!shortToken) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_token_response' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }

  // Exchange for long-lived user token (best-effort)
  let userToken = shortToken;
  try {
    const longUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID);
    longUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET);
    longUrl.searchParams.set('fb_exchange_token', shortToken);
    const longRes = await fetch(longUrl.toString(), { headers: { Accept: 'application/json' } });
    if (longRes.ok) {
      const longJson: any = await longRes.json().catch(() => null);
      if (typeof longJson?.access_token === 'string') userToken = longJson.access_token;
    }
  } catch { void 0; }

  // Get pages and pick the first page; use page access token for page posts API.
  const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,tasks&access_token=${encodeURIComponent(userToken)}`);
  const pagesText = await pagesRes.text().catch(() => '');
  if (!pagesRes.ok) {
    console.error('[FB] pages_fetch_failed', pagesRes.status, pagesText);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'pages_fetch_failed', status: pagesRes.status }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }
  const pagesJson: any = pagesText ? JSON.parse(pagesText) : null;
  const pagesArr: any[] = Array.isArray(pagesJson?.data) ? pagesJson.data : [];
  const first = pagesArr[0] || null;
  const pageId = typeof first?.id === 'string' ? first.id : '';
  const pageName = typeof first?.name === 'string' ? first.name : null;
  const pageToken = typeof first?.access_token === 'string' ? first.access_token : '';
  if (!pageId || !pageToken) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'no_pages_found' }));
    return Response.redirect(`${clientUrl}/integrations?facebook=${data}`, 302);
  }

  // Persist SocialConnections (Hyperdrive) if available
  const sql = getSql(env);
  if (sql) {
    try {
      await sqlUpsertSocial(sql, { userId: sid, provider: 'facebook', providerId: pageId, name: pageName });
    } catch (e) { console.error('[DB] sqlUpsertSocial (facebook) failed', e); }
  }

  // Persist OAuth token into backend UserSettings for importer
  const backendOrigin = getBackendOrigin(env, request);
  try {
    await fetch(`${backendOrigin}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, email: '', name: pageName || 'Facebook User', imageUrl: null }),
    });
  } catch { void 0; }
  try {
    const settingsRes = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/facebook_oauth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: {
          // Backward-compatible single-page fields (used by older backend importers)
          accessToken: pageToken,
          pageId,
          pageName,
          // New: persist the long-lived user token and full pages list so backend can import across all pages
          userAccessToken: userToken,
          pages: pagesArr
            .map(p => ({
              id: typeof p?.id === 'string' ? p.id : (p?.id ? String(p.id) : ''),
              name: typeof p?.name === 'string' ? p.name : null,
              access_token: typeof p?.access_token === 'string' ? p.access_token : '',
              tasks: Array.isArray(p?.tasks) ? p.tasks.filter((t: any) => typeof t === 'string') : [],
            }))
            .filter(p => p.id && p.access_token),
        },
      }),
    });
    if (!settingsRes.ok) {
      const errText = await settingsRes.text().catch(() => '');
      console.error('[FB] persist facebook_oauth failed', settingsRes.status, errText.slice(0, 1200));
    }
  } catch (e) {
    console.error('[FB] failed to persist facebook_oauth', e);
  }

  const headers = new Headers();
  headers.append('Set-Cookie', buildFacebookCookie(JSON.stringify({ id: pageId, name: pageName }), 60 * 60 * 24 * 30, request.url));
  headers.append('Set-Cookie', buildTempCookie('fb_state', '', 0, request.url));
  const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'facebook', account: { id: pageId, name: pageName } }));
  headers.set('Location', `${clientUrl}/integrations?facebook=${data}`);
  return new Response(null, { status: 302, headers });
}

async function handleFacebookPermissions(request: Request, env: Env): Promise<Response> {
  const headers = buildCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
  }

  const backendOrigin = getBackendOrigin(env, request);
  try {
    const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/facebook_oauth`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ ok: true, connected: false }), { status: 200, headers });
    }
    const data: any = await res.json().catch(() => null);
    const value = data?.value || null;
    const userToken = typeof value?.userAccessToken === 'string' ? value.userAccessToken : '';
    const pages = Array.isArray(value?.pages) ? value.pages : [];
    if (!userToken) {
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ ok: true, connected: true, hasUserToken: false, pagesCount: pages.length }), { status: 200, headers });
    }

    const permRes = await fetch(`https://graph.facebook.com/v18.0/me/permissions?access_token=${encodeURIComponent(userToken)}`, {
      headers: { Accept: 'application/json' },
    });
    const permText = await permRes.text().catch(() => '');
    let permJson: any = null;
    try { permJson = permText ? JSON.parse(permText) : null; } catch { permJson = null; }

    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({
      ok: true,
      connected: true,
      hasUserToken: true,
      permissionsStatus: permRes.status,
      permissions: permJson,
      pagesPreview: pages.slice(0, 20).map((p: any) => ({
        id: typeof p?.id === 'string' ? p.id : (p?.id ? String(p.id) : ''),
        name: typeof p?.name === 'string' ? p.name : null,
        tasks: Array.isArray(p?.tasks) ? p.tasks.filter((t: any) => typeof t === 'string') : [],
      })),
    }), { status: 200, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
  }
}

async function handleFacebookPages(request: Request, env: Env): Promise<Response> {
  const headers = buildCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'unauthenticated' }), { status: 401, headers });
  }

  const backendOrigin = getBackendOrigin(env, request);
  try {
    const res = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/facebook_oauth`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ ok: true, connected: false, pages: [] }), { status: 200, headers });
    }
    const data: any = await res.json().catch(() => null);
    const value = data?.value || null;
    const pages = Array.isArray(value?.pages) ? value.pages : [];
    const normalized = pages
      .map((p: any) => {
        const id = typeof p?.id === 'string' ? p.id : (p?.id ? String(p.id) : '');
        const name = typeof p?.name === 'string' ? p.name : null;
        const tasks = Array.isArray(p?.tasks) ? p.tasks.filter((t: any) => typeof t === 'string') : [];
        const canPost = tasks.map((t: string) => (t || '').toUpperCase()).some((t: string) => t === 'CREATE_CONTENT' || t === 'MANAGE');
        return { id, name, tasks, canPost };
      })
      .filter((p: any) => p.id);

    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true, connected: true, pages: normalized }), { status: 200, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: false, error: 'backend_unreachable', backendOrigin, details: { message } }), { status: 502, headers });
  }
}

async function startYouTubeOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/youtube/callback', url.origin).toString();

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'google_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  let sid = getCookie(cookieHeader, 'sid');
  const headers = new Headers();
  if (!sid && isLocalhost) {
    sid = crypto.randomUUID();
    headers.append('Set-Cookie', buildSidCookie(sid, 60 * 60 * 24 * 30, request.url));
    const backendOrigin = getBackendOrigin(env, request);
    try {
      await fetch(`${backendOrigin}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid, email: '', name: 'Local Dev User', imageUrl: null }),
      });
    } catch { void 0; }
  }
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }

  const state = crypto.randomUUID();
  const verifier = base64UrlRandom(32);
  const challenge = await pkceChallengeS256(verifier);
  headers.append('Set-Cookie', buildTempCookie('yt_state', state, 10 * 60, request.url));
  headers.append('Set-Cookie', buildTempCookie('yt_verifier', verifier, 10 * 60, request.url));

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.readonly');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  headers.set('Location', authUrl.toString());
  return new Response(null, { status: 302, headers });
}

async function handleYouTubeCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/youtube/callback', url.origin).toString();

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error, errorDescription }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }
  if (!code) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'missing_code' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'google_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  const stateCookie = getCookie(cookieHeader, 'yt_state');
  const verifier = getCookie(cookieHeader, 'yt_verifier');
  const state = url.searchParams.get('state');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }
  if (!stateCookie || !state || stateCookie !== state || !verifier) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_state' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokenText = await tokenRes.text().catch(() => '');
  if (!tokenRes.ok) {
    console.error('[YT] token_exchange_failed', tokenRes.status, tokenText);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'token_exchange_failed', status: tokenRes.status }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }
  const tokenJson: any = tokenText ? JSON.parse(tokenText) : null;
  const accessToken = typeof tokenJson?.access_token === 'string' ? tokenJson.access_token : '';
  const refreshToken = typeof tokenJson?.refresh_token === 'string' ? tokenJson.refresh_token : null;
  const tokenType = typeof tokenJson?.token_type === 'string' ? tokenJson.token_type : 'bearer';
  const expiresIn = getNumber(tokenJson?.expires_in) || 0;
  const scope = typeof tokenJson?.scope === 'string' ? tokenJson.scope : '';
  if (!accessToken) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_token_response' }));
    return Response.redirect(`${clientUrl}/integrations?youtube=${data}`, 302);
  }

  // Best-effort: fetch channel info to display.
  let channelId: string | null = null;
  let channelTitle: string | null = null;
  try {
    const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const chTxt = await chRes.text().catch(() => '');
    if (chRes.ok) {
      const chJson: any = chTxt ? JSON.parse(chTxt) : null;
      const items: any[] = Array.isArray(chJson?.items) ? chJson.items : [];
      if (items[0]?.id) channelId = String(items[0].id);
      if (items[0]?.snippet?.title) channelTitle = String(items[0].snippet.title);
    } else {
      console.warn('[YT] channel_fetch_failed', chRes.status, chTxt);
    }
  } catch (e) {
    console.warn('[YT] channel_fetch_error', e);
  }

  // Even if channel lookup fails, mark as connected so UI reflects token storage (imports rely on youtube_oauth).
  if (!channelId) {
    channelId = `youtube-${sid}`;
  }

  // Persist SocialConnections (Hyperdrive) if available
  const sql = getSql(env);
  if (sql && channelId) {
    try {
      await sqlUpsertSocial(sql, { userId: sid, provider: 'youtube', providerId: channelId, name: channelTitle });
    } catch (e) {
      console.error('[DB] sqlUpsertSocial (youtube) failed', e);
    }
  }

  const backendOrigin = getBackendOrigin(env, request);
  const obtainedAt = new Date().toISOString();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  try {
    await fetch(`${backendOrigin}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, email: '', name: channelTitle || 'YouTube User', imageUrl: null }),
    });
  } catch { void 0; }
  try {
    const settingsRes = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/youtube_oauth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { accessToken, refreshToken, tokenType, scope, obtainedAt, expiresAt, raw: tokenJson } }),
    });
    if (!settingsRes.ok) {
      const errText = await settingsRes.text().catch(() => '');
      console.error('[YT] persist youtube_oauth failed', settingsRes.status, errText.slice(0, 1200));
    }
  } catch (e) {
    console.error('[YT] failed to persist youtube_oauth', e);
  }

  const headers = new Headers();
  headers.append('Set-Cookie', buildYouTubeCookie(JSON.stringify({ id: channelId, name: channelTitle }), 60 * 60 * 24 * 30, request.url));
  headers.append('Set-Cookie', buildTempCookie('yt_state', '', 0, request.url));
  headers.append('Set-Cookie', buildTempCookie('yt_verifier', '', 0, request.url));
  const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'youtube', account: { id: channelId, name: channelTitle } }));
  headers.set('Location', `${clientUrl}/integrations?youtube=${data}`);
  return new Response(null, { status: 302, headers });
}

async function startPinterestOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/pinterest/callback', url.origin).toString();

  const clientId = (env.PINTEREST_CLIENT_ID || '').trim();
  const clientSecret = (env.PINTEREST_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'pinterest_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }

  const state = crypto.randomUUID();
  const headers = new Headers();
  headers.append('Set-Cookie', buildTempCookie('pin_state', state, 10 * 60, request.url));

  const authUrl = new URL('https://www.pinterest.com/oauth/');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);
  // Pinterest scopes (requested per product requirements)
  authUrl.searchParams.set('scope', [
    'boards:read',
    'boards:read_secret',
    'boards:write',
    'boards:write_secret',
    'pins:read',
    'pins:read_secret',
    'pins:write',
    'pins:write_secret',
    'user_accounts',
  ].join(','));

  headers.set('Location', authUrl.toString());
  return new Response(null, { status: 302, headers });
}

async function handlePinterestCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/pinterest/callback', url.origin).toString();

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }
  if (!code) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'missing_code' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }
  const clientId = (env.PINTEREST_CLIENT_ID || '').trim();
  const clientSecret = (env.PINTEREST_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'pinterest_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  const stateCookie = getCookie(cookieHeader, 'pin_state');
  const state = url.searchParams.get('state');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }
  if (!stateCookie || !state || stateCookie !== state) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_state' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenText = await tokenRes.text().catch(() => '');
  if (!tokenRes.ok) {
    console.error('[PIN] token_exchange_failed', tokenRes.status, tokenText);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'token_exchange_failed', status: tokenRes.status }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }
  const tokenJson: any = tokenText ? JSON.parse(tokenText) : null;
  const accessToken = typeof tokenJson?.access_token === 'string' ? tokenJson.access_token : '';
  const tokenType = typeof tokenJson?.token_type === 'string' ? tokenJson.token_type : 'bearer';
  const expiresIn = getNumber(tokenJson?.expires_in) || 0;
  const scope = typeof tokenJson?.scope === 'string' ? tokenJson.scope : '';
  if (!accessToken) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_token_response' }));
    return Response.redirect(`${clientUrl}/integrations?pinterest=${data}`, 302);
  }

  // Best-effort user profile
  let accountId: string | null = null;
  let accountName: string | null = null;
  try {
    const meRes = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const meText = await meRes.text().catch(() => '');
    if (meRes.ok) {
      const meJson: any = meText ? JSON.parse(meText) : null;
      accountId = typeof meJson?.id === 'string' ? meJson.id : (meJson?.id ? String(meJson.id) : null);
      accountName = typeof meJson?.username === 'string' ? meJson.username : null;
    } else {
      console.warn('[PIN] user_account_failed', meRes.status, meText);
    }
  } catch (e) {
    console.warn('[PIN] user_account_error', e);
  }

  // Even if profile lookup fails, mark the integration as connected so UI can reflect it.
  // We use a stable per-session id; imports rely on pinterest_oauth in UserSettings (not this id).
  if (!accountId) {
    accountId = `pinterest-${sid}`;
  }

  const sql = getSql(env);
  if (sql && accountId) {
    try {
      await sqlUpsertSocial(sql, { userId: sid, provider: 'pinterest', providerId: accountId, name: accountName });
    } catch (e) {
      console.error('[DB] sqlUpsertSocial (pinterest) failed', e);
    }
  }

  const backendOrigin = getBackendOrigin(env, request);
  const obtainedAt = new Date().toISOString();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  try {
    await fetch(`${backendOrigin}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, email: '', name: accountName || 'Pinterest User', imageUrl: null }),
    });
  } catch { void 0; }
  try {
    const settingsRes = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/pinterest_oauth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { accessToken, tokenType, scope, obtainedAt, expiresAt, raw: tokenJson } }),
    });
    if (!settingsRes.ok) {
      const errText = await settingsRes.text().catch(() => '');
      console.error('[PIN] persist pinterest_oauth failed', settingsRes.status, errText.slice(0, 1200));
    }
  } catch (e) {
    console.error('[PIN] failed to persist pinterest_oauth', e);
  }

  const headers = new Headers();
  headers.append('Set-Cookie', buildPinterestCookie(JSON.stringify({ id: accountId, name: accountName }), 60 * 60 * 24 * 30, request.url));
  headers.append('Set-Cookie', buildTempCookie('pin_state', '', 0, request.url));
  const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'pinterest', account: { id: accountId, name: accountName } }));
  headers.set('Location', `${clientUrl}/integrations?pinterest=${data}`);
  return new Response(null, { status: 302, headers });
}

async function startThreadsOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/threads/callback', url.origin).toString();

  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'threads_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }

  const state = crypto.randomUUID();
  const headers = new Headers();
  headers.append('Set-Cookie', buildTempCookie('th_state', state, 10 * 60, request.url));

  // Threads publishing permissions.
  // Ref: Meta Threads API docs (permission list): https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
  const scopes = ['threads_basic', 'threads_content_publish'].join(',');
  const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
  authUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  headers.set('Location', authUrl.toString());
  return new Response(null, { status: 302, headers });
}

async function handleThreadsCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const clientUrl = isLocalhost ? `http://localhost:18910` : url.origin.replace(/\/_worker\/.*/, '');
  const redirectUri = new URL('/api/integrations/threads/callback', url.origin).toString();

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error, errorDescription }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }
  if (!code) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'missing_code' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'threads_secrets_missing' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const sid = getCookie(cookieHeader, 'sid');
  const stateCookie = getCookie(cookieHeader, 'th_state');
  const state = url.searchParams.get('state');
  if (!sid) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'unauthenticated' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }
  if (!stateCookie || !state || stateCookie !== state) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_state' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }

  const tokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', env.INSTAGRAM_APP_ID);
  tokenUrl.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const tokenRes = await fetch(tokenUrl.toString(), { headers: { Accept: 'application/json' } });
  const tokenText = await tokenRes.text().catch(() => '');
  if (!tokenRes.ok) {
    console.error('[TH] token_exchange_failed', tokenRes.status, tokenText);
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'token_exchange_failed', status: tokenRes.status }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }
  const tokenJson: any = tokenText ? JSON.parse(tokenText) : null;
  const accessToken = typeof tokenJson?.access_token === 'string' ? tokenJson.access_token : '';
  const tokenType = typeof tokenJson?.token_type === 'string' ? tokenJson.token_type : 'bearer';
  const expiresIn = getNumber(tokenJson?.expires_in) || 0;
  if (!accessToken) {
    const data = encodeURIComponent(JSON.stringify({ success: false, error: 'invalid_token_response' }));
    return Response.redirect(`${clientUrl}/integrations?threads=${data}`, 302);
  }

  // Best-effort: discover threads user id. This may need adjustment depending on Meta configuration.
  let threadsUserId: string | null = null;
  let name: string | null = null;
  try {
    const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    const meText = await meRes.text().catch(() => '');
    if (meRes.ok) {
      const meJson: any = meText ? JSON.parse(meText) : null;
      threadsUserId = meJson?.id ? String(meJson.id) : null;
      name = typeof meJson?.name === 'string' ? meJson.name : null;
    } else {
      console.warn('[TH] me_failed', meRes.status, meText);
    }
  } catch (e) {
    console.warn('[TH] me_error', e);
  }

  const sql = getSql(env);
  if (sql && threadsUserId) {
    try {
      await sqlUpsertSocial(sql, { userId: sid, provider: 'threads', providerId: threadsUserId, name });
    } catch (e) {
      console.error('[DB] sqlUpsertSocial (threads) failed', e);
    }
  }

  const backendOrigin = getBackendOrigin(env, request);
  const obtainedAt = new Date().toISOString();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  try {
    await fetch(`${backendOrigin}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, email: '', name: name || 'Threads User', imageUrl: null }),
    });
  } catch { void 0; }
  try {
    const settingsRes = await fetch(`${backendOrigin}/api/user-settings/${encodeURIComponent(sid)}/threads_oauth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { accessToken, tokenType, threadsUserId, obtainedAt, expiresAt, raw: tokenJson } }),
    });
    if (!settingsRes.ok) {
      const errText = await settingsRes.text().catch(() => '');
      console.error('[TH] persist threads_oauth failed', settingsRes.status, errText.slice(0, 1200));
    }
  } catch (e) {
    console.error('[TH] failed to persist threads_oauth', e);
  }

  const headers = new Headers();
  headers.append('Set-Cookie', buildThreadsCookie(JSON.stringify({ id: threadsUserId, name }), 60 * 60 * 24 * 30, request.url));
  headers.append('Set-Cookie', buildTempCookie('th_state', '', 0, request.url));
  const data = encodeURIComponent(JSON.stringify({ success: true, provider: 'threads', account: { id: threadsUserId, name } }));
  headers.set('Location', `${clientUrl}/integrations?threads=${data}`);
  return new Response(null, { status: 302, headers });
}

// --- Cookie helpers for Instagram connection persistence ---
function buildInstagramCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `ig_conn=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  } else {
    parts.push('Max-Age=0');
  }
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function parseInstagramCookie(cookieHeader: string): { id: string; username: string | null } | null {
  const entries = cookieHeader
    .split(/;\s*/)
    .map(kv => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv, ''];
      return [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))] as [string, string];
    });
  const cookies = Object.fromEntries(entries);
  const raw = cookies['ig_conn'];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Cookie helpers for TikTok connection persistence ---
function buildTikTokCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `tt_conn=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  } else {
    parts.push('Max-Age=0');
  }
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function parseTikTokCookie(cookieHeader: string): { id: string; displayName: string | null } | null {
  const entries = cookieHeader
    .split(/;\s*/)
    .map(kv => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv, ''];
      return [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))] as [string, string];
    });
  const cookies = Object.fromEntries(entries);
  const raw = cookies['tt_conn'];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = asRecord(parsed);
    const id = getString(obj?.['id']);
    const displayName = getString(obj?.['displayName']);
    if (!id) return null;
    return { id, displayName: displayName ?? null };
  } catch {
    return null;
  }
}

// --- Cookie helpers for Facebook connection persistence ---
function buildFacebookCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `fb_conn=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  parts.push(`Max-Age=${maxAgeSeconds > 0 ? maxAgeSeconds : 0}`);
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function parseFacebookCookie(cookieHeader: string): { id: string; name: string | null } | null {
  const entries = cookieHeader
    .split(/;\s*/)
    .map(kv => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv, ''];
      return [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))] as [string, string];
    });
  const cookies = Object.fromEntries(entries);
  const raw = cookies['fb_conn'];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = asRecord(parsed);
    const id = getString(obj?.['id']);
    const name = getString(obj?.['name']);
    if (!id) return null;
    return { id, name: name ?? null };
  } catch {
    return null;
  }
}

// --- Cookie helpers for YouTube connection persistence ---
function buildYouTubeCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `yt_conn=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  parts.push(`Max-Age=${maxAgeSeconds > 0 ? maxAgeSeconds : 0}`);
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function parseYouTubeCookie(cookieHeader: string): { id: string; name: string | null } | null {
  const entries = cookieHeader
    .split(/;\s*/)
    .map(kv => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv, ''];
      return [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))] as [string, string];
    });
  const cookies = Object.fromEntries(entries);
  const raw = cookies['yt_conn'];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = asRecord(parsed);
    const id = getString(obj?.['id']);
    const name = getString(obj?.['name']);
    if (!id) return null;
    return { id, name: name ?? null };
  } catch {
    return null;
  }
}

// --- Cookie helpers for Pinterest connection persistence ---
function buildPinterestCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `pin_conn=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  parts.push(`Max-Age=${maxAgeSeconds > 0 ? maxAgeSeconds : 0}`);
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function parsePinterestCookie(cookieHeader: string): { id: string; name: string | null } | null {
  const entries = cookieHeader
    .split(/;\s*/)
    .map(kv => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv, ''];
      return [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))] as [string, string];
    });
  const cookies = Object.fromEntries(entries);
  const raw = cookies['pin_conn'];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = asRecord(parsed);
    const id = getString(obj?.['id']);
    const name = getString(obj?.['name']);
    if (!id) return null;
    return { id, name: name ?? null };
  } catch {
    return null;
  }
}

// --- Cookie helpers for Threads connection persistence ---
function buildThreadsCookie(value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `th_conn=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  parts.push(`Max-Age=${maxAgeSeconds > 0 ? maxAgeSeconds : 0}`);
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function parseThreadsCookie(cookieHeader: string): { id: string; name: string | null } | null {
  const entries = cookieHeader
    .split(/;\s*/)
    .map(kv => {
      const idx = kv.indexOf('=');
      if (idx === -1) return [kv, ''];
      return [kv.slice(0, idx), decodeURIComponent(kv.slice(idx + 1))] as [string, string];
    });
  const cookies = Object.fromEntries(entries);
  const raw = cookies['th_conn'];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = asRecord(parsed);
    const id = getString(obj?.['id']);
    const name = getString(obj?.['name']);
    if (!id) return null;
    return { id, name: name ?? null };
  } catch {
    return null;
  }
}

function buildTempCookie(name: string, value: string, maxAgeSeconds: number, requestUrl?: string): string {
  const isHttps = requestUrl ? new URL(requestUrl).protocol === 'https:' : false;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  } else {
    parts.push('Max-Age=0');
  }
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function base64UrlRandom(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function pkceChallengeS256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}
