export type ApiResult<T> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number; error: { message: string; code?: string }; data: unknown; headers: Headers };

function safeToMessage(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message || 'error';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const merged: RequestInit = { ...(init || {}) };
  if (!merged.credentials) merged.credentials = 'include';
  return await fetch(input, merged);
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await apiFetch(input, init);
    const data = await safeJson(res);

    if (res.ok) {
      return { ok: true, status: res.status, data: data as T, headers: res.headers };
    }

    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const code = typeof obj?.code === 'string' ? (obj.code as string) : undefined;
    const message =
      (typeof obj?.error === 'string' ? (obj.error as string) : '') ||
      (typeof obj?.message === 'string' ? (obj.message as string) : '') ||
      `request_failed_${res.status}`;
    return { ok: false, status: res.status, error: { message, code }, data, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, error: { message: safeToMessage(e) || 'network_error' }, data: null, headers: new Headers() };
  }
}
