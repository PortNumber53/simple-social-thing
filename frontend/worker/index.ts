import postgres from 'postgres';

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  USE_MOCK_AUTH?: string;
  ASSETS?: Fetcher;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  SUNO_API_KEY?: string;
  SUNO_CALLBACK_URL?: string;
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
        const sid = getCookie(cookie, 'sid');
        // Prefer Hyperdrive-backed status if we have a session id and SQL client
        if (sid) {
          const sql = getSql(env);
          if (sql) {
            try {
              const row = await sqlQuerySocial(sql, sid, 'instagram');
              if (row) {
                return Response.json({ instagram: { connected: true, account: { id: row.providerId, username: row.name || null } } });
              }
            } catch { void 0; }
          }
        }
        // Fallback to cookie-only status
        return Response.json({ instagram: conn ? { connected: true, account: conn } : { connected: false } });
      }

      // Instagram disconnect clears cookie
      if (url.pathname === "/api/integrations/instagram/disconnect") {
        const headers = new Headers({ 'Set-Cookie': buildInstagramCookie('', 0) });
        return new Response(null, { status: 204, headers });
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
	const sunoApiKey = perUserKey || env.SUNO_API_KEY;
	const useMock = env.USE_MOCK_AUTH === 'true' || !sunoApiKey;

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
		const callBackUrl =
			(env.SUNO_CALLBACK_URL && env.SUNO_CALLBACK_URL.trim() !== '')
				? env.SUNO_CALLBACK_URL.trim()
				: new URL('/callback/suno/music/', origin).toString();

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
	const sunoApiKey = perUserKey || env.SUNO_API_KEY;
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
		const data: unknown = await res.json().catch(() => null);
		if (!res.ok) {
			return new Response(JSON.stringify({ ok: false, error: 'suno_credits_failed', status: res.status, details: data }), { status: 502, headers });
		}
		headers.set('Content-Type', 'application/json');
		return new Response(JSON.stringify({ ok: true, credits: data }), { status: 200, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: 'suno_unreachable', details: { message } }), { status: 502, headers });
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
	const sunoApiKey = perUserKey || env.SUNO_API_KEY;
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
	if (env.BACKEND_ORIGIN) return env.BACKEND_ORIGIN;
	const url = new URL(request.url);
	const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (isLocal) {
		return 'http://localhost:18911';
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
    'pages_read_engagement'
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
    const short = (await tokenRes.json()) as { access_token: string };

    // Step 2: Get user pages and find linked Instagram business account
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=name,instagram_business_account&access_token=${encodeURIComponent(short.access_token)}`);
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
    const igRes = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(igId)}?fields=username&access_token=${encodeURIComponent(short.access_token)}`);
    const ig = igRes.ok ? ((await igRes.json()) as { username?: string }) : {};

    // Persist connection via Hyperdrive SQL when available (falls back to no-op on DB)
    const cookieHeader = request.headers.get('Cookie') || '';
    const sid = getCookie(cookieHeader, 'sid');
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
