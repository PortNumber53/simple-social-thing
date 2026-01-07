import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../components/Layout';
import { SegmentedControl } from '../components/SegmentedControl';
import { UploadGrid, type UploadPreview } from '../components/library/UploadGrid';
import { useIntegrations, type ProviderKey } from '../contexts/IntegrationsContext';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../lib/api';
import { safeStorage } from '../lib/safeStorage';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

type LocalPost = {
  id: string;
  content?: string | null;
  status: 'draft' | 'scheduled' | 'published' | string;
  providers?: string[] | null;
  media?: string[] | null;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  lastPublishJobId?: string | null;
  lastPublishStatus?: string | null;
  lastPublishError?: string | null;
  lastPublishAttemptAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const Library: React.FC = () => {
  const { user } = useAuth();
  const storage = safeStorage();
  const { status: integrationsStatus } = useIntegrations();
  const [statusFilter, setStatusFilter] = useState<'draft' | 'scheduled'>('draft');
  const [items, setItems] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishingNowId, setPublishingNowId] = useState<string | null>(null);

  const [editing, setEditing] = useState<LocalPost | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftStatus, setDraftStatus] = useState<'draft' | 'scheduled'>('draft');
  const [scheduledForLocal, setScheduledForLocal] = useState<string>('');
  const [draftProviders, setDraftProviders] = useState<Set<ProviderKey>>(() => new Set());
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [uploads, setUploads] = useState<UploadPreview[]>([]);
  const [uploadFolders, setUploadFolders] = useState<Array<{ id: string; name: string }>>([{ id: '', name: 'Root' }]);
  const [uploadFolder, setUploadFolder] = useState<string>(''); // '' means Root
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsRef = useRef<UploadPreview[]>([]);
  const [dragUploadId, setDragUploadId] = useState<string | null>(null);
  const [dragOverUploadId, setDragOverUploadId] = useState<string | null>(null);
  const [selectedUploadIds, setSelectedUploadIds] = useState<Set<string>>(() => new Set());
  const [draftMediaIds, setDraftMediaIds] = useState<string[]>([]);
  const [dragOverDraftMedia, setDragOverDraftMedia] = useState(false);
  const [lastUploadError, setLastUploadError] = useState<string | null>(null);
  const [panelSplit, setPanelSplit] = useState<number>(() => {
    const stored = storage.getJSON<number>('drafts_split');
    const n = stored ?? NaN;
    if (!Number.isFinite(n) || n <= 0.15 || n >= 0.85) return 0.35;
    return n;
  });
  const [panelLayout, setPanelLayout] = useState<number[]>([panelSplit * 100, 100 - panelSplit * 100]);
  const [leftTab, setLeftTab] = useState<'list' | 'edit'>('list');

  const allProviders: ProviderKey[] = ['instagram', 'tiktok', 'facebook', 'youtube', 'pinterest', 'threads'];
  const providerLabels: Record<ProviderKey, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    youtube: 'YouTube',
    pinterest: 'Pinterest',
    threads: 'Threads',
  };

  const isProviderConnected = (p: ProviderKey) => {
    const s = integrationsStatus || {};
    return !!s[p]?.connected;
  };

  const formatUploadError = (e: unknown) => {
    if (!e) return 'upload_failed';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message || 'upload_failed';
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  };

  const fileUrlForId = (id: string) => `/api/local-library/uploads/file/${encodeURIComponent(id)}`;

  const fallbackToLocalPreviewIfPossible = (u: UploadPreview) => {
    // If remote URL fails to render but we still have the File in memory, fall back to an object URL preview.
    if (!u?.file) return;
    if (typeof u.url === 'string' && u.url.startsWith('blob:')) return;
    try {
      const localUrl = URL.createObjectURL(u.file);
      setUploads((prev) => prev.map((x) => (x.id === u.id ? { ...x, url: localUrl } : x)));
    } catch { /* ignore */ }
  };

  const load = useCallback(async (status: 'draft' | 'scheduled') => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/local-library/items?status=${encodeURIComponent(status)}`, { credentials: 'include' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError('Failed to load local library.');
        return;
      }
      setItems(Array.isArray(data) ? (data as LocalPost[]) : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to load local library.');
    } finally {
      setLoading(false);
    }
  }, []);

  const publishStateFor = (p: LocalPost): { label: string; tone: 'neutral' | 'info' | 'warn' | 'success' | 'danger' } => {
    const s = String(p.lastPublishStatus || '').trim().toLowerCase();
    if (s === 'queued') return { label: 'Queued', tone: 'warn' };
    if (s === 'running') return { label: 'Publishing…', tone: 'info' };
    if (s === 'failed') return { label: 'Failed', tone: 'danger' };
    if (s === 'completed') return { label: 'Published', tone: 'success' };
    return { label: p.status === 'scheduled' ? 'Scheduled' : '—', tone: 'neutral' };
  };

  const publishBadgeClass = (tone: 'neutral' | 'info' | 'warn' | 'success' | 'danger') => {
    switch (tone) {
      case 'info':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200 border-blue-200/70 dark:border-blue-800/60';
      case 'warn':
        return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 border-amber-200/70 dark:border-amber-800/60';
      case 'success':
        return 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200 border-green-200/70 dark:border-green-800/60';
      case 'danger':
        return 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200 border-rose-200/70 dark:border-rose-800/60';
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200 border-slate-200/70 dark:border-slate-700/70';
    }
  };

  const processingCount = useMemo(() => {
    if (statusFilter !== 'scheduled') return 0;
    return items.filter((p) => {
      const s = String(p.lastPublishStatus || '').toLowerCase();
      return s === 'queued' || s === 'running';
    }).length;
  }, [items, statusFilter]);

  const publishNow = async (p: LocalPost) => {
    setError(null);
    setNotice(null);
    setPublishingNowId(p.id);
    try {
      const res = await fetch(`/api/local-library/items/${encodeURIComponent(p.id)}/publish-now`, { method: 'POST', credentials: 'include' });
      const text = await res.text().catch(() => '');
      if (!res.ok) throw new Error(text || `publish_now_failed_${res.status}`);
      setNotice('Queued publish job.');
      await load(statusFilter);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'publish_now_failed');
    } finally {
      setPublishingNowId(null);
    }
  };

  useEffect(() => {
    void load(statusFilter);
  }, [load, statusFilter]);

  useEffect(() => {
    const apply = async () => {
      if (!user?.id) return;
      try {
        const res = await apiJson<Record<string, unknown>>(`/api/user-settings/${encodeURIComponent(user.id)}/drafts_split`);
        const val = res.ok && res.data && typeof (res.data as any).value === 'number' ? (res.data as any).value : null;
        if (val !== null && Number.isFinite(val) && val > 0.15 && val < 0.85) {
          setPanelSplit(val);
          storage.setJSON('drafts_split', val);
          setPanelLayout([val * 100, 100 - val * 100]);
        }
      } catch {
        // ignore
      }
    };
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const persistSplit = useCallback(
    async (val: number) => {
      storage.setJSON('drafts_split', val);
      if (!user?.id) return;
      await apiJson(`/api/user-settings/${encodeURIComponent(user.id)}/drafts_split`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val }),
      });
    },
    [storage, user?.id],
  );

  const handleLayout = useCallback(
    (sizes: number[]) => {
      if (!Array.isArray(sizes) || sizes.length < 2) return;
      const left = sizes[0];
      const total = sizes.reduce((a, b) => a + b, 0) || 100;
      const ratio = left / total;
      if (!Number.isFinite(ratio) || ratio <= 0.15 || ratio >= 0.85) return;
      setPanelLayout(sizes);
      setPanelSplit(ratio);
      void persistSplit(ratio);
    },
    [persistSplit],
  );

  // Realtime: refresh the list when backend signals a post publish/update (scheduler or publish-now).
  const statusFilterRef = useRef(statusFilter);
  useEffect(() => {
    statusFilterRef.current = statusFilter;
  }, [statusFilter]);

  const noticeRef = useRef<string | null>(null);
  useEffect(() => {
    noticeRef.current = notice;
  }, [notice]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/api/events/ws`;
    const ws = new WebSocket(wsUrl);
    let isOpen = false;

    let t: number | null = null;
    const scheduleRefresh = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        void load(statusFilterRef.current);
      }, 300);
    };

    ws.onopen = () => {
      isOpen = true;
      // eslint-disable-next-line no-console
      console.info('[Library] realtime websocket connected');
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as any;
        if (!msg || typeof msg !== 'object') return;
        const type = String(msg.type || '');
        if (type === 'post.updated') {
          const st = String(msg.status || '').toLowerCase();
          if (!noticeRef.current && (st === 'queued' || st === 'running')) {
            setNotice(st === 'queued' ? 'Queued for publishing…' : 'Publishing in progress…');
          }
          scheduleRefresh();
        }
        if (type === 'post.publish') {
          const st = String(msg.status || '').toLowerCase();
          if (!noticeRef.current) {
            setNotice(st === 'completed' ? 'Published.' : st === 'failed' ? 'Publish failed.' : 'Publish finished.');
          }
          scheduleRefresh();
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      // Keep quiet in-prod; this just helps local debugging.
      // eslint-disable-next-line no-console
      console.warn('[Library] realtime websocket error');
    };
    ws.onclose = () => {
      isOpen = false;
      // eslint-disable-next-line no-console
      console.warn('[Library] realtime websocket closed');
    };

    // Fallback: if WS never connects (proxy/upgrade issues), poll while on the Scheduled tab.
    const poll =
      statusFilterRef.current === 'scheduled'
        ? window.setInterval(() => {
          if (!isOpen) void load('scheduled');
        }, 5000)
        : null;

    return () => {
      if (t) window.clearTimeout(t);
      if (poll) window.clearInterval(poll);
      try { ws.close(); } catch { /* ignore */ }
    };
  }, [load]);

  const resetEditorToNewDraft = () => {
    setEditing(null);
    setDraftText('');
    setDraftStatus('draft');
    setScheduledForLocal('');
    setDraftProviders(new Set());
    setDraftMediaIds([]);
  };

  const addFiles = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const tempUrlById = new Map<string, string>();
    const temps = arr.map((f) => {
      const type = (f.type || '').toLowerCase();
      const kind: UploadPreview['kind'] =
        type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'other';
      const tempId = `temp_${crypto.randomUUID()}`;
      const localUrl = URL.createObjectURL(f);
      tempUrlById.set(tempId, localUrl);
      return {
        id: tempId,
        file: f,
        url: localUrl,
        filename: f.name,
        kind,
        uploading: true,
        progress: 0,
        error: null,
      } as UploadPreview;
    });

    setUploads((prev) => [...temps, ...prev]);

    const ensureFileName = (id: string, fallback: string) => {
      const fn = (fallback || '').trim();
      return fn ? fn : id;
    };

    const uploadOneWithProgress = (tempId: string, file: File): Promise<{ id: string; url: string; kind: UploadPreview['kind']; filename: string }> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const qs = uploadFolder ? `?folder=${encodeURIComponent(uploadFolder)}` : '';
        xhr.open('POST', `/api/local-library/uploads${qs}`, true);
        xhr.withCredentials = true;
        xhr.timeout = 2 * 60 * 1000; // 2 minutes per file

        xhr.upload.onloadstart = () => {
          setUploads((prev) => prev.map((u) => (u.id === tempId ? { ...u, progress: 1 } : u)));
        };
        xhr.upload.onprogress = (evt) => {
          // Some environments report lengthComputable=false for uploads; fall back to file size.
          const total = evt.lengthComputable && evt.total > 0 ? evt.total : (file.size || 0);
          const pct =
            total > 0
              ? Math.max(0, Math.min(100, Math.round((evt.loaded / total) * 100)))
              : 1;
          setUploads((prev) => prev.map((u) => (u.id === tempId ? { ...u, progress: pct } : u)));
        };

        xhr.onerror = () => reject(new Error('upload_failed_network'));
        xhr.onabort = () => reject(new Error('upload_aborted'));
        xhr.ontimeout = () => reject(new Error('upload_timed_out'));
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            const snippet = (xhr.responseText || '').slice(0, 500);
            reject(new Error(`upload_failed_${xhr.status}${snippet ? `: ${snippet}` : ''}`));
            return;
          }
          let parsed: unknown = null;
          try { parsed = JSON.parse(xhr.responseText || 'null'); } catch { parsed = null; }
          const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
          const itemsAny = obj?.items;
          const first = Array.isArray(itemsAny) && itemsAny.length > 0 ? itemsAny[0] : null;
          const it = first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
          const id = typeof it?.id === 'string' ? (it!.id as string) : (typeof it?.filename === 'string' ? (it!.filename as string) : '');
          const url = typeof it?.url === 'string' ? (it!.url as string) : '';
          const kindRaw = typeof it?.kind === 'string' ? (it!.kind as string) : '';
          const kind: UploadPreview['kind'] =
            kindRaw === 'image' || kindRaw === 'video' || kindRaw === 'audio' || kindRaw === 'other' ? (kindRaw as any) : 'other';
          if (!id || !url) {
            reject(new Error(`upload_failed_bad_response: ${(xhr.responseText || '').slice(0, 800)}`));
            return;
          }
          // Prefer backend-provided public /media/... url (works for social networks too).
          // Fall back to the legacy scoped endpoint when url isn't provided.
          resolve({ id, url: (url || fileUrlForId(id)), kind, filename: ensureFileName(id, file.name) });
        };

        const form = new FormData();
        form.append('files', file, file.name);
        xhr.send(form);
      });
    };

    const applyMapping = (tempId: string, real: { id: string; url: string; kind: UploadPreview['kind']; filename: string }) => {
      setUploads((prev) =>
        prev.map((u) => {
          if (u.id !== tempId) return u;
          const localUrl = tempUrlById.get(tempId);
          if (localUrl) URL.revokeObjectURL(localUrl);
          return {
            id: real.id,
            url: real.url,
            filename: real.filename,
            kind: real.kind || u.kind,
            file: u.file,
            uploading: false,
            progress: 100,
            error: null,
          };
        }),
      );
      setSelectedUploadIds((prev) => {
        if (!prev.has(tempId)) return prev;
        const next = new Set(prev);
        next.delete(tempId);
        next.add(real.id);
        return next;
      });
      setDraftMediaIds((prev) => prev.map((id) => (id === tempId ? real.id : id)));
      setDragUploadId((prev) => (prev === tempId ? real.id : prev));
      setDragOverUploadId((prev) => (prev === tempId ? real.id : prev));
    };

    const markFailed = (tempId: string, message: string) => {
      setLastUploadError(message || 'upload_failed');
      setUploads((prev) =>
        prev.map((u) => (u.id === tempId ? { ...u, uploading: false, error: message || 'upload_failed' } : u)),
      );
    };

    // Upload each file (per-file progress). Limit concurrency to keep UI responsive.
    const concurrency = 3;
    const createdTempIds = temps.map((t) => t.id);

    void (async () => {
      let i = 0;
      const runOne = async (tempId: string, file: File) => {
        try {
          const real = await uploadOneWithProgress(tempId, file);
          applyMapping(tempId, real);
        } catch (e: unknown) {
          const msg = formatUploadError(e);
          markFailed(tempId, msg);
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, createdTempIds.length) }).map(async () => {
        while (i < createdTempIds.length) {
          const my = i++;
          const tempId = createdTempIds[my];
          const file = arr[my];
          if (!tempId || !file) continue;
          await runOne(tempId, file);
        }
      });
      await Promise.all(workers);
    })();
  };

  const clearUploads = () => {
    const idsToDelete = uploads.map((u) => u.id);
    void (async () => {
      if (idsToDelete.length === 0) return;
      try {
        await fetch('/api/local-library/uploads/delete', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: idsToDelete }),
        });
      } catch { /* ignore */ }
    })();
    setUploads((prev) => {
      for (const u of prev) {
        if (typeof u.url === 'string' && u.url.startsWith('blob:')) URL.revokeObjectURL(u.url);
      }
      return [];
    });
    setSelectedUploadIds(new Set());
    setDraftMediaIds([]);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const removeUpload = (id: string) => {
    void (async () => {
      try {
        await fetch('/api/local-library/uploads/delete', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [id] }),
        });
      } catch { /* ignore */ }
    })();
    setUploads((prev) => {
      const u = prev.find((x) => x.id === id);
      if (u && typeof u.url === 'string' && u.url.startsWith('blob:')) URL.revokeObjectURL(u.url);
      return prev.filter((x) => x.id !== id);
    });
    setSelectedUploadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDraftMediaIds((prev) => prev.filter((x) => x !== id));
  };

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    return () => {
      // Cleanup object URLs on unmount.
      for (const u of uploadsRef.current) {
        if (typeof u.url === 'string' && u.url.startsWith('blob:')) URL.revokeObjectURL(u.url);
      }
    };
  }, []);

  useEffect(() => {
    // Load existing uploaded files from backend so uploads persist across reloads.
    const loadUploads = async (folder: string) => {
      try {
        const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
        const res = await fetch(`/api/local-library/uploads${qs}`, { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const itemsUnknown = obj ? obj.items : null;
        const items: unknown[] = Array.isArray(itemsUnknown) ? itemsUnknown : [];
        const next: UploadPreview[] = [];
        for (const raw of items) {
          const it = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
          const id = typeof it?.id === 'string' ? it.id : (typeof it?.filename === 'string' ? it.filename : '');
          const filename = typeof it?.filename === 'string' ? it.filename : id;
          const rawUrl = typeof it?.url === 'string' ? it.url : '';
          const url = rawUrl ? rawUrl : (id ? fileUrlForId(id) : '');
          const kind = it?.kind === 'image' || it?.kind === 'video' || it?.kind === 'audio' || it?.kind === 'other' ? it.kind : 'other';
          if (!id || !url) continue;
          next.push({ id, url, filename, kind, uploading: false, error: null });
        }
        setUploads(next);
      } catch { /* ignore */ }
    };

    void loadUploads(uploadFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFolder]);

  useEffect(() => {
    // Load folder list for the media gallery.
    void (async () => {
      try {
        const res = await fetch('/api/local-library/uploads/folders', { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);
        const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const raw = obj?.folders;
        const arr: unknown[] = Array.isArray(raw) ? raw : [];
        const next: Array<{ id: string; name: string }> = [];
        for (const it of arr) {
          const r = it && typeof it === 'object' ? (it as Record<string, unknown>) : null;
          const id = typeof r?.id === 'string' ? r.id : '';
          const name = typeof r?.name === 'string' ? r.name : (id || 'Root');
          next.push({ id, name });
        }
        if (next.length > 0) setUploadFolders(next);
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reorderUploads = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    setUploads((prev) => {
      const fromIdx = prev.findIndex((u) => u.id === fromId);
      const toIdx = prev.findIndex((u) => u.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const parseUploadIdsFromDataTransfer = (dt: DataTransfer): string[] => {
    const raw = dt.getData('application/x-sst-upload-ids');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string') as string[];
    } catch { /* ignore */ }
    return [];
  };

  const attachUploadsToDraft = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setDraftMediaIds((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
      return next;
    });
  };

  const removeDraftMedia = (id: string) => {
    setDraftMediaIds((prev) => prev.filter((x) => x !== id));
  };

  const uploadById = useMemo(() => {
    const m = new Map<string, UploadPreview>();
    for (const u of uploads) m.set(u.id, u);
    return m;
  }, [uploads]);

  const draftMedia = useMemo(() => {
    return draftMediaIds.map((id) => uploadById.get(id)).filter((x): x is UploadPreview => !!x);
  }, [draftMediaIds, uploadById]);

  const scrollToEditor = () => {
    const el = editorRef.current;
    if (!el) return;
    // JSDOM (tests) doesn't implement scrollIntoView; guard for it.
    const fn = (el as any).scrollIntoView;
    if (typeof fn === 'function') fn.call(el, { behavior: 'smooth', block: 'start' });
  };

  const openNew = () => {
    setLeftTab('edit');
    resetEditorToNewDraft();
    window.setTimeout(scrollToEditor, 0);
  };

  const openEdit = (p: LocalPost) => {
    setLeftTab('edit');
    setEditing(p);
    setDraftText((p.content || '').toString());
    setDraftStatus((p.status === 'scheduled' ? 'scheduled' : 'draft'));
    if (p.scheduledFor) {
      const d = new Date(p.scheduledFor);
      const pad = (n: number) => String(n).padStart(2, '0');
      const local =
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setScheduledForLocal(local);
    } else {
      setScheduledForLocal('');
    }
    const prov = Array.isArray(p.providers) ? p.providers : [];
    setDraftProviders(
      new Set(
        prov
          .map((x) => String(x || '').trim().toLowerCase())
          .filter((x): x is ProviderKey => x === 'instagram' || x === 'tiktok' || x === 'facebook' || x === 'youtube' || x === 'pinterest' || x === 'threads'),
      ),
    );
    // Persisted as rel paths in DB; map back to upload ids (filename) when possible.
    const media = Array.isArray(p.media) ? p.media : [];
    const ids = media
      .map((m) => {
        const s = String(m || '').trim();
        if (!s) return '';
        const last = s.split('?')[0].split('#')[0].split('/').pop() || '';
        return last.trim();
      })
      .filter(Boolean);
    setDraftMediaIds(ids);
    window.setTimeout(scrollToEditor, 0);
  };

  const toIsoOrNull = (localValue: string): string | null => {
    const v = localValue.trim();
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const save = async () => {
    const content = draftText.trim();
    const scheduledForIso = toIsoOrNull(scheduledForLocal);
    const providers = Array.from(draftProviders);
    // Treat selected uploads as "pending attach" so scheduling doesn't require an extra click.
    // Only count uploads that finished successfully (not uploading, not errored).
    const selectedMediaIds = Array.from(selectedUploadIds).filter((id) => {
      const u = uploadById.get(id);
      if (!u) return false;
      if (u.uploading) return false;
      if (u.error) return false;
      return true;
    });
    const mediaIdsForSave = [
      ...draftMediaIds,
      ...selectedMediaIds.filter((id) => !draftMediaIds.includes(id)),
    ];
    const media = mediaIdsForSave
      .map((id) => uploadById.get(id))
      .filter((x): x is UploadPreview => !!x)
      .map((u) => {
        const raw = String(u?.url || '').trim();
        if (!raw) return null;
        if (raw.startsWith('/media/')) return raw;
        try {
          const parsed = new URL(raw);
          if (parsed.pathname.startsWith('/media/')) return parsed.pathname;
        } catch { /* ignore */ }
        return null;
      })
      .filter((x): x is string => !!x);

    if (draftStatus === 'scheduled' && !scheduledForIso) {
      setError('Pick a valid scheduled time.');
      return;
    }
    if (draftStatus === 'scheduled' && providers.length === 0) {
      setError('Select at least one network.');
      return;
    }
    if (draftStatus === 'scheduled') {
      const requiresMedia = providers.some((p) => p === 'instagram' || p === 'pinterest' || p === 'tiktok' || p === 'youtube');
      if (requiresMedia && media.length === 0) {
        setError('Attach at least one upload before scheduling to this network (it requires media).');
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      // If the user had selected uploads (but not explicitly attached them), persist them as draft media after a successful save.
      const persistAutoAttached = () => {
        if (selectedMediaIds.length === 0) return;
        setDraftMediaIds(mediaIdsForSave);
        setSelectedUploadIds((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          selectedMediaIds.forEach((id) => next.delete(id));
          return next;
        });
      };
      if (editing) {
        const res = await fetch(`/api/local-library/items/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, status: draftStatus, scheduledFor: scheduledForIso, providers, media }),
        });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
          setError('Failed to save.');
        return;
      }
        persistAutoAttached();
        const updated = data as LocalPost;
        // If the update moves the post between tabs, switch tabs.
        if (updated.status === 'draft' || updated.status === 'scheduled') {
          if (updated.status !== statusFilter) setStatusFilter(updated.status);
        }
        setItems((prev) => {
          if (updated.status !== statusFilter) return prev.filter((p) => p.id !== updated.id);
          return prev.map((p) => (p.id === updated.id ? updated : p));
        });
        setEditing(updated);
      } else {
        const res = await fetch(`/api/local-library/items`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, status: draftStatus, scheduledFor: scheduledForIso, providers, media }),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setError('Failed to create.');
          return;
        }
        persistAutoAttached();
        const created = data as LocalPost;
        if (created.status === 'draft' || created.status === 'scheduled') {
          if (created.status !== statusFilter) setStatusFilter(created.status);
        }
        setItems((prev) => (created.status === statusFilter ? [created, ...prev] : prev));
        setEditing(created);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: LocalPost) => {
    const ok = window.confirm('Delete this item?');
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/local-library/items/${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        setError('Failed to delete.');
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to delete.');
    }
  };

  const emptyState = useMemo(() => {
    if (statusFilter === 'draft') return 'No drafts yet. Create one to start planning your publishing.';
    return 'No scheduled items yet.';
  }, [statusFilter]);

  return (
    <Layout>
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto space-y-4 min-h-[70vh]">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 mt-1 mb-1 h-6">
          <span className="text-slate-500 dark:text-slate-400">Home</span>
          <span className="text-slate-400">/</span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">Drafts</span>
        </div>

        <div className="min-h-[60vh]" style={{ height: 'calc(100vh - 180px)' }}>
          <PanelGroup direction="horizontal" layout={panelLayout} onLayout={handleLayout} className="h-full w-full flex">
            <Panel defaultSize={panelLayout[0] ?? panelSplit * 100} minSize={20}>
              <div className="card p-0 h-full overflow-hidden flex flex-col" style={{ minWidth: '320px' }}>
                <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40">
                  {/* Unified toolbar: Drafts/Scheduled + New draft + Refresh */}
                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                      value={statusFilter}
                      options={[
                        { value: 'draft', label: 'Drafts' },
                        { value: 'scheduled', label: 'Scheduled' },
                      ]}
                      onChange={(v) => {
                        setStatusFilter(v);
                        setLeftTab('list');
                      }}
                    />

                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {loading ? 'Loading…' : `${items.length} item(s)`}
                    </div>

                    {statusFilter === 'scheduled' && processingCount > 0 && (
                      <div className="text-xs px-2 py-1 rounded-md border border-amber-200/70 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200">
                        Processing {processingCount} post(s)…
                      </div>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          openNew();
                          setLeftTab('edit');
                        }}
                        disabled={saving}
                      >
                        New draft
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => void load(statusFilter)} disabled={loading}>
                        Refresh
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  {leftTab === 'list' ? (
                    <div className="flex flex-col h-full">
                      <div className="divide-y divide-slate-200/60 dark:divide-slate-700/40 overflow-auto">
                        {items.length === 0 ? (
                          <div className="p-8 text-slate-500 dark:text-slate-400">{emptyState}</div>
                        ) : (
                          items.map((p) => {
                            const scheduledLabel = p.scheduledFor ? new Date(p.scheduledFor).toLocaleString() : '—';
                            const createdLabel = p.createdAt ? new Date(p.createdAt).toLocaleString() : '';
                            const prov = Array.isArray(p.providers) ? p.providers : [];
                            const mediaCount = Array.isArray(p.media) ? p.media.length : 0;
                            const pub = publishStateFor(p);
                            const canPublishNow =
                              p.status === 'scheduled' && !['queued', 'running'].includes(String(p.lastPublishStatus || '').toLowerCase());
                            const provLabel = prov.length
                              ? prov
                                  .map((x) => String(x || '').trim().toLowerCase())
                                  .filter(Boolean)
                                  .map((x) => (x in providerLabels ? providerLabels[x as ProviderKey] : x))
                                  .join(', ')
                              : '';
                            const preview = (p.content || '').trim();
                            return (
                              <div key={p.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                                      {p.status}
                                    </span>
                                    {p.status === 'scheduled' && (
                                      <span
                                        className={[
                                          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
                                          publishBadgeClass(pub.tone),
                                        ].join(' ')}
                                        title={p.lastPublishJobId ? `job: ${p.lastPublishJobId}` : ''}
                                      >
                                        {String(p.lastPublishStatus || '').toLowerCase() === 'running' ? (
                                          <span className="inline-block w-2 h-2 rounded-full bg-current opacity-70 animate-pulse" />
                                        ) : null}
                                        {pub.label}
                                      </span>
                                    )}
                                    {p.status === 'scheduled' && (
                                      <span className="text-xs text-slate-600 dark:text-slate-300">Scheduled: {scheduledLabel}</span>
                                    )}
                                  </div>
                                  <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                                    Networks: {provLabel ? provLabel : '—'}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    Media: {mediaCount}
                                  </div>
                                  {p.lastPublishAttemptAt && p.status === 'scheduled' && (
                                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                      Last attempt: {new Date(p.lastPublishAttemptAt).toLocaleString()}
                                    </div>
                                  )}
                                  {String(p.lastPublishStatus || '').toLowerCase() === 'failed' && p.lastPublishError && (
                                    <div className="mt-1 text-xs text-rose-700 dark:text-rose-200">Error: {p.lastPublishError}</div>
                                  )}
                                  <div className="mt-2 text-sm text-slate-900 dark:text-slate-50 break-words">
                                    {preview ? preview : <span className="text-slate-500 dark:text-slate-400">No content</span>}
                                  </div>
                                  {createdLabel && (
                                    <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">Created: {createdLabel}</div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {p.status === 'scheduled' && (
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={() => void publishNow(p)}
                                      disabled={!canPublishNow || publishingNowId === p.id || saving || loading}
                                      title="Enqueue this scheduled post immediately"
                                    >
                                      {publishingNowId === p.id ? 'Publishing…' : !canPublishNow ? 'Processing…' : 'Publish Now'}
                                    </button>
                                  )}
                                  <button type="button" className="btn btn-secondary" onClick={() => openEdit(p)}>
                                    Edit
                                  </button>
                                  <a
                                    className="btn btn-ghost"
                                    href={`/content/posts?caption=${encodeURIComponent((p.content || '').toString())}`}
                                    title="Open in publisher (caption-only)"
                                  >
                                    Open publisher
                                  </a>
                                  <button type="button" className="btn btn-ghost text-red-600 hover:text-red-700" onClick={() => void remove(p)}>
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : (
                    <div ref={editorRef} className="p-5 space-y-4 h-full overflow-auto">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                            {editing ? 'Edit draft' : 'New draft'}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            {editing ? `ID: ${editing.id}` : 'Create local content you can reuse and schedule later.'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setLeftTab('list')}
                            disabled={saving}
                            title="Back to list"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={openNew}
                            disabled={saving}
                            title="Clear the form"
                          >
                            New
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Content</label>
                        <textarea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          rows={8}
                          className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
                          placeholder="Write your caption / notes…"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
                          <select
                            value={draftStatus}
                            onChange={(e) => setDraftStatus(e.target.value === 'scheduled' ? 'scheduled' : 'draft')}
                            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
                          >
                            <option value="draft">Draft</option>
                            <option value="scheduled">Scheduled</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Scheduled for</label>
                          <input
                            type="datetime-local"
                            value={scheduledForLocal}
                            onChange={(e) => {
                              const v = e.target.value;
                              setScheduledForLocal(v);
                              if (v && draftStatus !== 'scheduled') setDraftStatus('scheduled');
                            }}
                            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm"
                          />
                          {draftStatus !== 'scheduled' && scheduledForLocal.trim() !== '' && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300">
                              This time will be used once the status is set to “Scheduled”.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Networks</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                setDraftProviders(new Set(allProviders));
                              }}
                              disabled={allProviders.length === 0}
                              title="Select all networks"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => setDraftProviders(new Set())}
                              disabled={draftProviders.size === 0}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {allProviders.map((p) => {
                            const connected = isProviderConnected(p);
                            const checked = draftProviders.has(p);
                            const warn = checked && !connected;
                            return (
                              <div
                                key={p}
                                className={[
                                  'flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm',
                                  warn ? 'border-amber-300/70 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-900/10' : '',
                                ].join(' ')}
                                title={
                                  connected ? '' : 'Not connected yet — you can still plan/schedule, but connect before publish time.'
                                }
                              >
                                <label className="flex items-center gap-2 flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const v = e.target.checked;
                                      setDraftProviders((prev) => {
                                        const next = new Set(prev);
                                        if (v) next.add(p);
                                        else next.delete(p);
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="text-slate-800 dark:text-slate-100 truncate">{providerLabels[p]}</span>
                                </label>
                                {!connected ? (
                                  <a
                                    className="text-xs underline hover:no-underline text-slate-600 dark:text-slate-300"
                                    href="/integrations"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    connect
                                  </a>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        {draftStatus === 'scheduled' && draftProviders.size === 0 && (
                          <div className="text-xs text-amber-700 dark:text-amber-200">Pick at least one network before scheduling.</div>
                        )}
                        {draftProviders.size > 0 && Array.from(draftProviders).some((p) => !isProviderConnected(p)) && (
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            Some selected networks are not connected yet. Connect them before the scheduled time to publish successfully.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Media</label>
                          <div className="flex items-center gap-2">
                            {selectedUploadIds.size > 0 && (
                              <button
                                type="button"
                                className="text-xs underline text-slate-600 dark:text-slate-300"
                                onClick={() => attachUploadsToDraft(Array.from(selectedUploadIds))}
                              >
                                Add selected ({selectedUploadIds.size})
                              </button>
                            )}
                            {draftMediaIds.length > 0 && (
                              <button
                                type="button"
                                className="text-xs underline text-slate-600 dark:text-slate-300"
                                onClick={() => setDraftMediaIds([])}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>

                        <div
                          className={[
                            'rounded-lg border border-dashed p-3 text-sm',
                            dragOverDraftMedia
                              ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-900/10'
                              : 'border-slate-300/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/20',
                          ].join(' ')}
                          onDragOver={(e) => {
                            if (!e.dataTransfer.types.includes('application/x-sst-upload-ids')) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                            setDragOverDraftMedia(true);
                          }}
                          onDragLeave={() => setDragOverDraftMedia(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const ids = parseUploadIdsFromDataTransfer(e.dataTransfer);
                            attachUploadsToDraft(ids.length > 0 ? ids : Array.from(selectedUploadIds));
                            setDragOverDraftMedia(false);
                          }}
                        >
                          <div className="text-slate-700 dark:text-slate-200">Drop selected uploads here to attach them to this draft.</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Tip: select multiple thumbnails, then drag any one of them onto this area.
                          </div>
                        </div>

                        {draftMedia.length > 0 && (
                          <div className="grid grid-cols-2 gap-3">
                            {draftMedia.map((u) => (
                              <div key={u.id} className="card p-0 overflow-hidden">
                                <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                                  {u.kind === 'image' ? (
                                    <img
                                      src={u.url}
                                      alt=""
                                      className="w-full h-full object-cover"
                                      onError={() => fallbackToLocalPreviewIfPossible(u)}
                                    />
                                  ) : u.kind === 'video' ? (
                                    <video
                                      src={u.url}
                                      className="w-full h-full object-cover"
                                      muted
                                      playsInline
                                      onError={() => fallbackToLocalPreviewIfPossible(u)}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                                      <span className="text-sm">File</span>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    className="absolute top-2 right-2 bg-slate-900/70 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs hover:bg-slate-900/80"
                                    aria-label={`Remove ${u.filename}`}
                                    onClick={() => removeDraftMedia(u.id)}
                                  >
                                    ×
                                  </button>
                                  <div
                                    className={[
                                      'absolute left-2 right-2 rounded-md bg-black/60 text-white text-[11px] px-2 py-1 truncate',
                                      u.uploading || u.error ? 'bottom-9' : 'bottom-2',
                                    ].join(' ')}
                                  >
                                    {u.filename}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            resetEditorToNewDraft();
                            setError(null);
                          }}
                          disabled={saving}
                        >
                          Clear
                        </button>
                        {editing && (
                          <a
                            className="btn btn-secondary"
                            href={`/content/posts?caption=${encodeURIComponent(draftText.trim())}`}
                            title="Open in publisher (caption-only)"
                          >
                            Open publisher
                          </a>
                        )}
                      </div>

                      {error && <div className="text-sm text-red-600 dark:text-red-300">{error}</div>}
                      {notice && <div className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Scheduled publishing runs in the background. Use “Publish Now” to trigger a scheduled item immediately for testing.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="w-1.5 bg-slate-200 dark:bg-slate-700 rounded cursor-col-resize my-2" />

            <Panel defaultSize={panelLayout[1] ?? (100 - panelSplit * 100)} minSize={20}>
              <div className="card p-0 overflow-hidden h-full flex flex-col min-w-[360px]">
                <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/40">
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-50">Media browser</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Select uploads, drag them onto the draft media area, or use “Add selected”.
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Folder</label>
                    <select
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
                      value={uploadFolder}
                      onChange={(e) => setUploadFolder(e.target.value)}
                    >
                      {uploadFolders.map((f) => (
                        <option key={f.id || '__root__'} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        const name = window.prompt('New folder name (letters/numbers/_-):', 'Exports') || '';
                        const trimmed = name.trim();
                        if (!trimmed) return;
                        // Optimistically add; backend creates folder on first upload into it.
                        setUploadFolders((prev) => {
                          if (prev.some((x) => x.id === trimmed)) return prev;
                          return [...prev, { id: trimmed, name: trimmed }].sort((a, b) => (a.id === '' ? -1 : b.id === '' ? 1 : a.name.localeCompare(b.name)));
                        });
                        setUploadFolder(trimmed);
                      }}
                      title="Create folder"
                    >
                      + Folder
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-3">
                  <UploadGrid
                    uploads={uploads}
                    selectedUploadIds={selectedUploadIds}
                    setSelectedUploadIds={setSelectedUploadIds}
                    dragUploadId={dragUploadId}
                    setDragUploadId={setDragUploadId}
                    dragOverUploadId={dragOverUploadId}
                    setDragOverUploadId={setDragOverUploadId}
                    lastUploadError={lastUploadError}
                    uploadInputRef={uploadInputRef}
                    addFiles={addFiles}
                    clearUploads={clearUploads}
                    removeUpload={removeUpload}
                    reorderUploads={reorderUploads}
                    parseUploadIdsFromDataTransfer={parseUploadIdsFromDataTransfer}
                    fallbackToLocalPreviewIfPossible={fallbackToLocalPreviewIfPossible}
                  />
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </Layout>
  );
};
