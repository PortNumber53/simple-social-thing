import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { getMediaDurationSec } from '../components/videoEditor/media';
import {
  clipDurationSec,
  clipEndSec,
  makeId,
  sortClipsByStart,
  type Clip,
  type MediaClip,
  type MediaKind,
  type MediaPart,
  type Project,
  type TextClip,
  type Track,
} from '../components/videoEditor/types';
import { VideoEditorTimeline, type SelectedClipRef } from '../components/videoEditor/VideoEditorTimeline';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function findTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

function findClip(track: Track, clipId: string): Clip | undefined {
  return track.clips.find((c) => c.id === clipId);
}

function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolveUrl(u: string): string {
  const raw = String(u || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, window.location.href).toString();
  } catch {
    return raw;
  }
}

function trackKindForMediaKind(kind: MediaKind): 'video' | 'audio' {
  if (kind === 'audio') return 'audio';
  // images are visual and live on the video track
  return 'video';
}

function mediaPartAtTime(clip: MediaClip, t: number): { part: MediaPart; mediaTimeSec: number } | null {
  const into = t - clip.startSec;
  if (into < 0) return null;
  let acc = 0;
  for (const p of clip.parts) {
    const used = Math.max(0, p.cropEndSec - p.cropStartSec);
    if (into < acc + used || (used === 0 && into <= acc)) {
      const local = Math.max(0, into - acc);
      return { part: p, mediaTimeSec: p.cropStartSec + local };
    }
    acc += used;
  }
  return clip.parts.length ? { part: clip.parts[clip.parts.length - 1]!, mediaTimeSec: clip.parts[clip.parts.length - 1]!.cropEndSec } : null;
}

function projectEnd(prev: Project): number {
  let max = 0;
  for (const tr of prev.tracks) for (const c of tr.clips) max = Math.max(max, clipEndSec(c));
  return max;
}

function canGlueWithNext(track: Track, clipId: string): { ok: boolean; nextId?: string; reason?: string } {
  const clips = [...track.clips].sort(sortClipsByStart);
  const idx = clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return { ok: false, reason: 'Clip not found' };
  const a = clips[idx];
  const b = clips[idx + 1];
  if (!b) return { ok: false, reason: 'No next clip' };
  if (a.kind === 'text' || b.kind === 'text') return { ok: false, reason: 'Glue is for media clips' };
  if (a.kind !== b.kind) return { ok: false, reason: 'Clips must be on the same layer type' };
  const gap = Math.abs(clipEndSec(a) - b.startSec);
  if (gap > 0.05) return { ok: false, reason: 'Clips must be adjacent (no gap) to glue' };
  return { ok: true, nextId: b.id };
}

function glueClips(track: Track, clipAId: string, clipBId: string): { track: Track; newClipId: string } {
  const clips = [...track.clips].sort(sortClipsByStart);
  const a = clips.find((c) => c.id === clipAId) as MediaClip | undefined;
  const b = clips.find((c) => c.id === clipBId) as MediaClip | undefined;
  if (!a || !b) return { track, newClipId: clipAId };
  const merged: MediaClip = {
    id: makeId('clip'),
    kind: a.kind,
    startSec: Math.min(a.startSec, b.startSec),
    parts: [...a.parts, ...b.parts],
  };
  const next = track.clips.filter((c) => c.id !== clipAId && c.id !== clipBId);
  next.push(merged);
  return { track: { ...track, clips: next }, newClipId: merged.id };
}

function defaultProject(): Project {
  return {
    id: makeId('project'),
    fps: 30,
    tracks: [
      { id: makeId('track'), kind: 'video', name: 'Video', clips: [] },
      { id: makeId('track'), kind: 'audio', name: 'Audio', clips: [] },
      { id: makeId('track'), kind: 'text', name: 'Text', clips: [] },
    ],
  };
}

function describeClip(clip: Clip): string {
  if (clip.kind === 'text') return `Text • ${clipDurationSec(clip).toFixed(2)}s`;
  const parts = clip.parts.length;
  const label = parts === 1 ? clip.parts[0]?.name || 'Clip' : `${parts} clips (glued)`;
  return `${label} • ${clipDurationSec(clip).toFixed(2)}s`;
}

export const ContentVideoEditor: React.FC = () => {
  const { user } = useAuth();
  const [project, setProject] = useState<Project>(() => defaultProject());
  const [selected, setSelected] = useState<SelectedClipRef>(null);
  const [playheadSec, setPlayheadSec] = useState<number>(0);
  const [pxPerSec, setPxPerSec] = useState<number>(90);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [lastExportUrl, setLastExportUrl] = useState<string>('');
  const [lastExportName, setLastExportName] = useState<string>('');
  const [exportVideoBps, setExportVideoBps] = useState<number>(2_500_000);
  const [exportAudioBps] = useState<number>(128_000);
  const [previewPreset, setPreviewPreset] = useState<string>('ig_reels');
  const [customAspectW, setCustomAspectW] = useState<number>(9);
  const [customAspectH, setCustomAspectH] = useState<number>(16);

  const [textDraft, setTextDraft] = useState<string>('New text');
  const [textDuration, setTextDuration] = useState<number>(3);
  const [imageDuration, setImageDuration] = useState<number>(3);
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string>('');

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryKind, setGalleryKind] = useState<MediaKind>('video');
  const [galleryFolders, setGalleryFolders] = useState<Array<{ id: string; name: string }>>([{ id: '', name: 'Root' }]);
  const [galleryFolder, setGalleryFolder] = useState<string>('');
  const [galleryItems, setGalleryItems] = useState<Array<{ id: string; url: string; filename: string; kind: 'image' | 'video' | 'audio' | 'other'; folder?: string }>>([]);
  const [gallerySelectedId, setGallerySelectedId] = useState<string>('');

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<Project>(project);
  const rafRef = useRef<number | null>(null);
  const playStartPerfRef = useRef<number>(0);
  const playStartSecRef = useRef<number>(0);
  const playheadRef = useRef<number>(playheadSec);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  useEffect(() => {
    playheadRef.current = playheadSec;
  }, [playheadSec]);

  useEffect(() => {
    return () => {
      // cleanup object URLs on unmount
      const p = projectRef.current;
      for (const t of p.tracks) {
        for (const c of t.clips) {
          if (c.kind === 'text') continue;
          for (const part of c.parts) {
            try {
              URL.revokeObjectURL(part.objectUrl);
            } catch {
              /* ignore */
            }
          }
        }
      }
    };
  }, []);

  const selectedTrack = useMemo(() => {
    if (!selected) return undefined;
    return findTrack(project, selected.trackId);
  }, [project, selected]);

  const selectedClip = useMemo(() => {
    if (!selectedTrack || !selected) return undefined;
    return findClip(selectedTrack, selected.clipId);
  }, [selected, selectedTrack]);

  const glueNext = useMemo(() => {
    if (!selectedTrack || !selectedClip) return { ok: false, reason: 'Select a clip' } as const;
    return canGlueWithNext(selectedTrack, selectedClip.id);
  }, [selectedClip, selectedTrack]);

  const projectEndSec = useMemo(() => {
    let max = 0;
    for (const t of project.tracks) for (const c of t.clips) max = Math.max(max, clipEndSec(c));
    return max;
  }, [project]);

  const exportLimits = useMemo(() => {
    const instagramMaxBytes = 300 * 1024 * 1024; // best-effort; platform rules may vary
    return { instagramMaxBytes };
  }, []);

  const estimatedExportBytes = useMemo(() => {
    const durationSec = Math.max(0.1, projectEndSec);
    const bitsPerSec = Math.max(0, Math.floor(exportVideoBps + exportAudioBps));
    return Math.floor((bitsPerSec * durationSec) / 8);
  }, [exportAudioBps, exportVideoBps, projectEndSec]);

  const autoReduceExportBitrateToFitInstagram = () => {
    const durationSec = Math.max(0.1, projectEndSec);
    const targetBitsPerSec = Math.floor((exportLimits.instagramMaxBytes * 8) / durationSec);
    const nextVideo = Math.max(300_000, targetBitsPerSec - exportAudioBps);
    setExportVideoBps(nextVideo);
    setMediaBusy(null);
  };

  const videoTrack = useMemo(() => project.tracks.find((t) => t.kind === 'video'), [project]);
  const audioTrack = useMemo(() => project.tracks.find((t) => t.kind === 'audio'), [project]);
  const textTrack = useMemo(() => project.tracks.find((t) => t.kind === 'text'), [project]);

  const activeVisual = useMemo(() => {
    const t = playheadSec;
    const clips = [...(videoTrack?.clips || [])].sort(sortClipsByStart) as Clip[];
    let chosen: Clip | null = null;
    for (const c of clips) {
      if (t >= c.startSec && t < clipEndSec(c)) chosen = c;
    }
    return chosen;
  }, [playheadSec, videoTrack]);

  const activeAudio = useMemo(() => {
    const t = playheadSec;
    const clips = [...(audioTrack?.clips || [])].sort(sortClipsByStart) as Clip[];
    let chosen: Clip | null = null;
    for (const c of clips) {
      if (t >= c.startSec && t < clipEndSec(c)) chosen = c;
    }
    return chosen;
  }, [audioTrack, playheadSec]);

  const activeAudioMediaClip = useMemo(() => {
    if (!activeAudio || activeAudio.kind === 'text') return null;
    return activeAudio as MediaClip;
  }, [activeAudio]);

  const activeAudioMediaAtPlayhead = useMemo(() => {
    if (!activeAudioMediaClip) return null;
    return mediaPartAtTime(activeAudioMediaClip, playheadSec);
  }, [activeAudioMediaClip, playheadSec]);

  const activeTextClips = useMemo(() => {
    const t = playheadSec;
    const clips = [...(textTrack?.clips || [])].sort(sortClipsByStart);
    return clips.filter((c) => c.kind === 'text' && t >= c.startSec && t < clipEndSec(c)) as TextClip[];
  }, [playheadSec, textTrack]);

  const activeVisualMediaClip = useMemo(() => {
    if (!activeVisual || activeVisual.kind === 'text') return null;
    return activeVisual as MediaClip;
  }, [activeVisual]);

  const activeVisualMediaAtPlayhead = useMemo(() => {
    if (!activeVisualMediaClip) return null;
    return mediaPartAtTime(activeVisualMediaClip, playheadSec);
  }, [activeVisualMediaClip, playheadSec]);

  const useVideoAudio = useMemo(() => {
    // If the audio clip is linked to the active video clip and points to the same URL,
    // rely on the <video> element audio (more compatible than trying to play mp4 via <audio> on some browsers).
    if (!activeVisualMediaAtPlayhead || !activeAudioMediaAtPlayhead) return false;
    const va = activeVisualMediaAtPlayhead.part;
    const aa = activeAudioMediaAtPlayhead.part;
    if (!va.assetId || !aa.assetId) return false;
    if (va.assetId !== aa.assetId) return false;
    if (!va.objectUrl || !aa.objectUrl) return false;
    return va.objectUrl === aa.objectUrl;
  }, [activeAudioMediaAtPlayhead, activeVisualMediaAtPlayhead]);

  const seekTo = (t: number) => {
    const clamped = Math.max(0, t);
    setPlayheadSec(clamped);
    setPlaybackError('');
    if (isPlaying) {
      playStartPerfRef.current = performance.now();
      playStartSecRef.current = clamped;
    }
  };

  const previewPresets = useMemo(
    () => [
      { id: 'ig_reels', label: 'Instagram Reels (9:16)', w: 9, h: 16 },
      { id: 'tiktok', label: 'TikTok (9:16)', w: 9, h: 16 },
      { id: 'yt_shorts', label: 'YouTube Shorts (9:16)', w: 9, h: 16 },
      { id: 'ig_story', label: 'Instagram Story (9:16)', w: 9, h: 16 },
      { id: 'landscape_16_9', label: 'Landscape video (16:9)', w: 16, h: 9 },
      { id: 'landscape_16_10', label: 'Landscape (16:10)', w: 16, h: 10 },
      { id: 'square', label: 'Square (1:1)', w: 1, h: 1 },
      { id: 'ig_feed_portrait', label: 'Instagram Feed Portrait (4:5)', w: 4, h: 5 },
      { id: 'custom', label: 'Custom…', w: 9, h: 16 },
    ],
    [],
  );

  const aspect = useMemo(() => {
    const p = previewPresets.find((x) => x.id === previewPreset) || previewPresets[0]!;
    if (p.id !== 'custom') return { w: p.w, h: p.h, label: p.label };
    return {
      w: Math.max(1, safeNumber(customAspectW, 9)),
      h: Math.max(1, safeNumber(customAspectH, 16)),
      label: 'Custom',
    };
  }, [customAspectH, customAspectW, previewPreset, previewPresets]);

  const exportTimeline = async () => {
    if (!user) return;
    if (isExporting) return;
    if (projectEndSec <= 0.05) return;
    setIsExporting(true);
    setMediaBusy('Exporting (server)…');
    setLastExportUrl('');
    setLastExportName('');
    // Open the export tab synchronously from the click handler.
    // Browsers often block window.open() if it's called after an await.
    let exportWin: Window | null = null;
    try {
      // NOTE: Some browsers may open the tab but return `null` when using noopener/noreferrer.
      // We prefer a reliable Window reference so we can navigate it once the export URL is ready.
      exportWin = window.open('about:blank', '_blank');
      // Best-effort protection against reverse tabnabbing.
      // about:blank is same-origin with us, so this should work.
      if (exportWin) exportWin.opener = null;
    } catch {
      exportWin = null;
    }
    try {
      const fps = Math.max(10, Math.min(60, Math.round(safeNumber(project.fps, 30))));
      const targetLong = 1280;

      const isServerUrl = (u: string) => {
        const raw = String(u || '').trim();
        if (!raw) return false;
        if (raw.startsWith('blob:')) return false;
        try {
          const uu = new URL(raw, window.location.href);
          return uu.pathname.startsWith('/media/');
        } catch {
          return raw.startsWith('/media/');
        }
      };

      const flattenTrack = (kind: 'video' | 'audio') => {
        const track = project.tracks.find((t) => t.kind === kind);
        const clips = [...(track?.clips || [])].sort(sortClipsByStart) as Clip[];
        const segs: Array<{ kind: 'video' | 'image' | 'audio'; startSec: number; sourceUrl: string; inSec: number; outSec: number }> = [];
        for (const c of clips) {
          if (c.kind === 'text') continue;
          if (kind === 'video' && (c.kind === 'video' || c.kind === 'image')) {
            let off = 0;
            for (const p of c.parts) {
              const dur = Math.max(0.001, (p.cropEndSec || 0) - (p.cropStartSec || 0));
              segs.push({
                kind: c.kind,
                startSec: c.startSec + off,
                sourceUrl: p.objectUrl,
                inSec: Math.max(0, p.cropStartSec || 0),
                outSec: Math.max(0.001, p.cropEndSec || dur),
              });
              off += dur;
            }
          }
          if (kind === 'audio' && c.kind === 'audio') {
            let off = 0;
            for (const p of c.parts) {
              const dur = Math.max(0.001, (p.cropEndSec || 0) - (p.cropStartSec || 0));
              segs.push({
                kind: 'audio',
                startSec: c.startSec + off,
                sourceUrl: p.objectUrl,
                inSec: Math.max(0, p.cropStartSec || 0),
                outSec: Math.max(0.001, p.cropEndSec || dur),
              });
              off += dur;
            }
          }
        }
        return segs;
      };

      const videoSegs = flattenTrack('video');
      const audioSegs = flattenTrack('audio');
      const textSegs = (project.tracks.find((t) => t.kind === 'text')?.clips || [])
        .filter((c) => c.kind === 'text')
        .map((c) => c as TextClip)
        .map((c) => ({ startSec: c.startSec, durationSec: c.durationSec, text: c.text || '' }));

      for (const s of [...videoSegs, ...audioSegs]) {
        if (!isServerUrl(s.sourceUrl)) {
          setMediaBusy('Export requires server-hosted media. Please add clips via Media Gallery (or re-add so they upload).');
          setIsExporting(false);
          try { exportWin?.close(); } catch { /* ignore */ }
          return;
        }
      }

      const payload = {
        projectId: project.id,
        fps,
        aspectW: aspect.w,
        aspectH: aspect.h,
        targetLong,
        videoBitrateBps: Math.max(300_000, Math.floor(exportVideoBps)),
        audioBitrateBps: Math.max(32_000, Math.floor(exportAudioBps)),
        video: videoSegs,
        audio: audioSegs,
        text: textSegs,
      };

      const res = await fetch('/api/local-library/video-editor/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const dataText = await res.text().catch(() => '');
      const data: unknown = (() => {
        try {
          return dataText ? JSON.parse(dataText) : null;
        } catch {
          return null;
        }
      })();
      if (!res.ok) {
        setMediaBusy(`Export failed (HTTP ${res.status}). ${String(dataText || '').slice(0, 600)}`);
        setIsExporting(false);
        try { exportWin?.close(); } catch { /* ignore */ }
        return;
      }
      const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const itemAny = obj?.item;
      const it = itemAny && typeof itemAny === 'object' ? (itemAny as Record<string, unknown>) : null;
      const urlRaw = typeof it?.url === 'string' ? String(it.url) : '';
      const url = resolveUrl(urlRaw);
      const filename = typeof it?.filename === 'string' ? String(it.filename) : 'export.mp4';

      setLastExportUrl(url);
      setLastExportName(filename);
      setMediaBusy(null);
      setIsExporting(false);
      if (url) {
        try {
          if (exportWin) {
            exportWin.location.href = url;
            exportWin.focus?.();
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        } catch {
          try { exportWin?.close(); } catch { /* ignore */ }
          /* ignore */
        }
      } else {
        // Avoid leaving a blank tab around when we didn't get a URL back.
        try { exportWin?.close(); } catch { /* ignore */ }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMediaBusy(`Export failed: ${msg}`);
      setIsExporting(false);
      try { exportWin?.close(); } catch { /* ignore */ }
    }
  };

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    playStartPerfRef.current = performance.now();
    playStartSecRef.current = playheadSec;

    const tick = () => {
      const now = performance.now();
      const t = playStartSecRef.current + (now - playStartPerfRef.current) / 1000;
      setPlayheadSec(t);
      if (t >= projectEndSec + 0.05) {
        setIsPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Sync preview media elements to playhead while playing (best-effort)
  useEffect(() => {
    const t = playheadSec;
    const v = videoPreviewRef.current;
    if (!v) return;
    if (!activeVisual || activeVisual.kind === 'text') return;
    if (activeVisual.kind === 'image') {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    if (activeVisual.kind !== 'video') return;
    const mt = mediaPartAtTime(activeVisual, t);
    if (!mt) return;
    const desiredSrc = resolveUrl(mt.part.objectUrl);
    const currentSrc = v.currentSrc || v.src || '';
    if (desiredSrc && currentSrc !== desiredSrc) {
      v.src = desiredSrc;
      try {
        v.load();
      } catch {
        /* ignore */
      }
    }
    // keep currentTime in sync
    try {
      const desired = clamp(mt.mediaTimeSec, 0, Number.isFinite(v.duration) ? v.duration : mt.mediaTimeSec);
      if (!Number.isFinite(v.currentTime) || Math.abs(v.currentTime - desired) > 0.25) v.currentTime = desired;
      if (isPlaying) {
        const p = v.play();
        if (p && typeof (p as any).catch === 'function') {
          (p as Promise<void>).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            setPlaybackError(msg || 'Playback blocked by browser policy');
          });
        }
      } else {
        v.pause();
      }
    } catch {
      /* ignore */
    }
  }, [activeVisual, isPlaying, playheadSec]);

  useEffect(() => {
    const t = playheadSec;
    const a = audioPreviewRef.current;
    if (!a) return;
    if (useVideoAudio) {
      try {
        a.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    if (!activeAudio || activeAudio.kind === 'text') {
      try {
        a.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    if (activeAudio.kind !== 'audio') return;
    const mt = mediaPartAtTime(activeAudio, t);
    if (!mt) return;
    const desiredSrc = resolveUrl(mt.part.objectUrl);
    const currentSrc = a.currentSrc || a.src || '';
    if (desiredSrc && currentSrc !== desiredSrc) {
      a.src = desiredSrc;
      try {
        a.load();
      } catch {
        /* ignore */
      }
    }
    try {
      const desired = clamp(mt.mediaTimeSec, 0, Number.isFinite(a.duration) ? a.duration : mt.mediaTimeSec);
      if (!Number.isFinite(a.currentTime) || Math.abs(a.currentTime - desired) > 0.25) a.currentTime = desired;
      if (isPlaying) {
        const p = a.play();
        if (p && typeof (p as any).catch === 'function') {
          (p as Promise<void>).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            setPlaybackError(msg || 'Playback blocked by browser policy');
          });
        }
      } else {
        a.pause();
      }
    } catch {
      /* ignore */
    }
  }, [activeAudio, isPlaying, playheadSec, useVideoAudio]);

  // Space toggles play/pause (unless focused in an input)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      const tag = (el?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (el && el.isContentEditable)) return;
      e.preventDefault();
      setIsPlaying((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const addMediaClip = async (kind: MediaKind, file: File) => {
    if (!user) return;
    const trackKind = trackKindForMediaKind(kind);
    const trackId = project.tracks.find((t) => t.kind === trackKind)?.id;
    if (!trackId) return;

    setMediaBusy(`Uploading ${kind}…`);

    // Upload to Media Gallery first so it's reusable via the Media browser.
    const form = new FormData();
    form.append('files', file, file.name);
    const res = await fetch('/api/local-library/uploads', { method: 'POST', credentials: 'include', body: form });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      setMediaBusy(null);
      throw new Error(`upload_failed_${res.status}`);
    }
    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const itemsAny = obj?.items;
    const first = Array.isArray(itemsAny) && itemsAny.length > 0 ? itemsAny[0] : null;
    const it = first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
    const remoteUrl = typeof it?.url === 'string' ? String(it.url) : '';

    const localObjectUrl = URL.createObjectURL(file); // local for quick metadata
    let dur = 0;
    if (kind === 'image') {
      dur = Math.max(0.1, safeNumber(imageDuration, 3));
    } else {
      try {
        dur = await getMediaDurationSec(localObjectUrl, kind);
      } catch {
        dur = 5;
      }
    }

    const part: MediaPart = {
      id: makeId('part'),
      kind,
      name: file.name || `${kind} clip`,
      objectUrl: remoteUrl || localObjectUrl,
      sourceDurationSec: dur || 0,
      cropStartSec: 0,
      cropEndSec: dur || 0,
    };
    if (remoteUrl) {
      try {
        URL.revokeObjectURL(localObjectUrl);
      } catch {
        /* ignore */
      }
    }

    const startAt = Math.max(projectEndSec, 0);
    const clip: MediaClip = { id: makeId('clip'), kind, startSec: startAt, parts: [part] };

    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)),
    }));
    setSelected({ trackId, clipId: clip.id });
    setPlayheadSec(startAt);
    setMediaBusy(null);
  };

  const addVideoWithAutoAudio = async (file: File) => {
    if (!user) return;
    const videoTrackId = project.tracks.find((t) => t.kind === 'video')?.id;
    const audioTrackId = project.tracks.find((t) => t.kind === 'audio')?.id;
    if (!videoTrackId || !audioTrackId) return;

    const assetId = makeId('asset');
    setMediaBusy('Uploading video…');

    const form = new FormData();
    form.append('files', file, file.name);
    const up = await fetch('/api/local-library/uploads', { method: 'POST', credentials: 'include', body: form });
    const upData: unknown = await up.json().catch(() => null);
    if (!up.ok) {
      setMediaBusy(null);
      throw new Error(`upload_failed_${up.status}`);
    }
    const upObj = upData && typeof upData === 'object' ? (upData as Record<string, unknown>) : null;
    const upItemsAny = upObj?.items;
    const upFirst = Array.isArray(upItemsAny) && upItemsAny.length > 0 ? upItemsAny[0] : null;
    const upIt = upFirst && typeof upFirst === 'object' ? (upFirst as Record<string, unknown>) : null;
    const remoteUrl = typeof upIt?.url === 'string' ? String(upIt.url) : '';

    // Local URL for duration only.
    const localUrl = URL.createObjectURL(file);

    let dur = 0;
    try {
      dur = await getMediaDurationSec(localUrl, 'video');
    } catch {
      dur = 5;
    }
    const baseDur = Math.max(0.1, dur || 0);
    if (remoteUrl) {
      try {
        URL.revokeObjectURL(localUrl);
      } catch {
        /* ignore */
      }
    }

    const vPart: MediaPart = {
      id: makeId('part'),
      kind: 'video',
      name: file.name || 'video clip',
      assetId,
      objectUrl: remoteUrl || localUrl,
      sourceDurationSec: baseDur,
      cropStartSec: 0,
      cropEndSec: baseDur,
    };
    const aPart: MediaPart = {
      id: makeId('part'),
      kind: 'audio',
      name: file.name ? `${file.name} (audio)` : 'audio from video',
      assetId,
      objectUrl: remoteUrl || localUrl,
      sourceDurationSec: baseDur,
      cropStartSec: 0,
      cropEndSec: baseDur,
    };

    const vClipId = makeId('clip');
    const aClipId = makeId('clip');

    setProject((prev) => {
      const startAt = Math.max(projectEnd(prev), 0);
      const vClip: MediaClip = { id: vClipId, kind: 'video', startSec: startAt, parts: [vPart] };
      const aClip: MediaClip = { id: aClipId, kind: 'audio', startSec: startAt, parts: [aPart] };
      return {
        ...prev,
        tracks: prev.tracks.map((t) => {
          if (t.id === videoTrackId) return { ...t, clips: [...t.clips, vClip] };
          if (t.id === audioTrackId) return { ...t, clips: [...t.clips, aClip] };
          return t;
        }),
      };
    });
    setSelected({ trackId: videoTrackId, clipId: vClipId });
    setPlayheadSec(projectEnd(projectRef.current));
    setMediaBusy(null);
  };

  const openGallery = async (kind: MediaKind) => {
    setGalleryKind(kind);
    setGallerySelectedId('');
    setGalleryOpen(true);
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
      if (next.length > 0) setGalleryFolders(next);
    } catch {
      /* ignore */
    }
  };

  const loadGalleryItems = async (folder: string) => {
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
    const res = await fetch(`/api/local-library/uploads${qs}`, { credentials: 'include' });
    const data: unknown = await res.json().catch(() => null);
    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const itemsUnknown = obj ? obj.items : null;
    const items: unknown[] = Array.isArray(itemsUnknown) ? itemsUnknown : [];
    const next: Array<{ id: string; url: string; filename: string; kind: 'image' | 'video' | 'audio' | 'other'; folder?: string }> = [];
    for (const raw of items) {
      const it = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const id = typeof it?.id === 'string' ? it.id : (typeof it?.filename === 'string' ? it.filename : '');
      const filename = typeof it?.filename === 'string' ? it.filename : id;
      const url = typeof it?.url === 'string' ? it.url : '';
      const kind = it?.kind === 'image' || it?.kind === 'video' || it?.kind === 'audio' || it?.kind === 'other' ? (it.kind as any) : 'other';
      const folderName = typeof it?.folder === 'string' ? it.folder : '';
      if (!id || !url) continue;
      next.push({ id, url, filename, kind, folder: folderName });
    }
    setGalleryItems(next);
  };

  useEffect(() => {
    if (!galleryOpen) return;
    void loadGalleryItems(galleryFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryOpen, galleryFolder]);

  const addFromGallery = async () => {
    if (!gallerySelectedId) return;
    const picked = galleryItems.find((x) => x.id === gallerySelectedId);
    if (!picked) return;
    const url = picked.url;

    if (galleryKind === 'image') {
      const trackId = project.tracks.find((t) => t.kind === 'video')?.id;
      if (!trackId) return;
      const dur = Math.max(0.1, safeNumber(imageDuration, 3));
      const startAt = Math.max(projectEndSec, 0);
      const clip: MediaClip = {
        id: makeId('clip'),
        kind: 'image',
        startSec: startAt,
        parts: [
          {
            id: makeId('part'),
            kind: 'image',
            name: picked.filename,
            objectUrl: url,
            sourceDurationSec: dur,
            cropStartSec: 0,
            cropEndSec: dur,
          },
        ],
      };
      setProject((prev) => ({ ...prev, tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)) }));
      setSelected({ trackId, clipId: clip.id });
      setPlayheadSec(startAt);
    } else if (galleryKind === 'audio') {
      const trackId = project.tracks.find((t) => t.kind === 'audio')?.id;
      if (!trackId) return;
      setMediaBusy('Loading audio metadata…');
      let dur = 0;
      try {
        dur = await getMediaDurationSec(url, 'audio');
      } catch {
        dur = 5;
      }
      const baseDur = Math.max(0.1, dur || 0);
      const startAt = Math.max(projectEndSec, 0);
      const clip: MediaClip = {
        id: makeId('clip'),
        kind: 'audio',
        startSec: startAt,
        parts: [
          { id: makeId('part'), kind: 'audio', name: picked.filename, objectUrl: url, sourceDurationSec: baseDur, cropStartSec: 0, cropEndSec: baseDur },
        ],
      };
      setProject((prev) => ({ ...prev, tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)) }));
      setSelected({ trackId, clipId: clip.id });
      setPlayheadSec(startAt);
      setMediaBusy(null);
    } else {
      // video: also auto-add audio
      const videoTrackId = project.tracks.find((t) => t.kind === 'video')?.id;
      const audioTrackId = project.tracks.find((t) => t.kind === 'audio')?.id;
      if (!videoTrackId || !audioTrackId) return;
      setMediaBusy('Loading video metadata…');
      let dur = 0;
      try {
        dur = await getMediaDurationSec(url, 'video');
      } catch {
        dur = 5;
      }
      const baseDur = Math.max(0.1, dur || 0);
      const assetId = makeId('asset');
      const startAt = Math.max(projectEndSec, 0);
      const vClipId = makeId('clip');
      const aClipId = makeId('clip');
      const vClip: MediaClip = {
        id: vClipId,
        kind: 'video',
        startSec: startAt,
        parts: [{ id: makeId('part'), kind: 'video', name: picked.filename, assetId, objectUrl: url, sourceDurationSec: baseDur, cropStartSec: 0, cropEndSec: baseDur }],
      };
      const aClip: MediaClip = {
        id: aClipId,
        kind: 'audio',
        startSec: startAt,
        parts: [{ id: makeId('part'), kind: 'audio', name: `${picked.filename} (audio)`, assetId, objectUrl: url, sourceDurationSec: baseDur, cropStartSec: 0, cropEndSec: baseDur }],
      };
      setProject((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) => {
          if (t.id === videoTrackId) return { ...t, clips: [...t.clips, vClip] };
          if (t.id === audioTrackId) return { ...t, clips: [...t.clips, aClip] };
          return t;
        }),
      }));
      setSelected({ trackId: videoTrackId, clipId: vClipId });
      setPlayheadSec(startAt);
      setMediaBusy(null);
    }

    setGalleryOpen(false);
  };

  const addTextClip = () => {
    const track = project.tracks.find((t) => t.kind === 'text');
    if (!track) return;
    const startAt = Math.max(projectEndSec, 0);
    const clip: TextClip = {
      id: makeId('clip'),
      kind: 'text',
      startSec: startAt,
      durationSec: Math.max(0.1, safeNumber(textDuration, 3)),
      text: String(textDraft || '').slice(0, 200),
    };
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t)),
    }));
    setSelected({ trackId: track.id, clipId: clip.id });
    setPlayheadSec(startAt);
  };

  const updateSelectedClip = (patch: Partial<Clip>) => {
    if (!selected) return;
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => {
        if (t.id !== selected.trackId) return t;
        return {
          ...t,
          clips: t.clips.map((c) => (c.id === selected.clipId ? ({ ...c, ...patch } as Clip) : c)),
        };
      }),
    }));
  };

  const updateSelectedMediaPart = (partIdx: number, patch: Partial<MediaPart>) => {
    if (!selected || !selectedTrack || !selectedClip || selectedClip.kind === 'text') return;
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => {
        if (t.id !== selected.trackId) return t;
        return {
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== selected.clipId) return c;
            if (c.kind === 'text') return c;
            const parts = c.parts.map((p, idx) => (idx === partIdx ? ({ ...p, ...patch } as MediaPart) : p));
            return { ...c, parts };
          }),
        };
      }),
    }));

    // If trimming a linked video part, also trim the corresponding audio part(s) from the same asset.
    if (selectedClip.kind === 'video') {
      const target = selectedClip.parts[partIdx];
      const assetId = target?.assetId;
      if (assetId && ('cropStartSec' in patch || 'cropEndSec' in patch)) {
        setProject((prev) => ({
          ...prev,
          tracks: prev.tracks.map((t) => {
            if (t.kind !== 'audio') return t;
            return {
              ...t,
              clips: t.clips.map((c) => {
                if (c.kind === 'text' || c.kind !== 'audio') return c;
                // only auto-sync simple "audio-from-video" clips (single-part matching asset)
                if (c.parts.length !== 1) return c;
                const p0 = c.parts[0]!;
                if (p0.assetId !== assetId) return c;
                const nextStart = 'cropStartSec' in patch ? clamp(safeNumber((patch as any).cropStartSec, p0.cropStartSec), 0, p0.cropEndSec) : p0.cropStartSec;
                const nextEnd =
                  'cropEndSec' in patch
                    ? clamp(safeNumber((patch as any).cropEndSec, p0.cropEndSec), nextStart, p0.sourceDurationSec)
                    : p0.cropEndSec;
                return { ...c, parts: [{ ...p0, cropStartSec: nextStart, cropEndSec: nextEnd }] };
              }),
            };
          }),
        }));
      }
    }
  };

  const deleteSelectedClip = () => {
    if (!selected) return;
    // revoke any blob URLs owned by the clip being removed
    const track = project.tracks.find((t) => t.id === selected.trackId);
    const clip = track ? track.clips.find((c) => c.id === selected.clipId) : undefined;
    if (clip && clip.kind !== 'text') {
      for (const part of clip.parts) {
        try {
          URL.revokeObjectURL(part.objectUrl);
        } catch {
          /* ignore */
        }
      }
    }
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === selected.trackId ? { ...t, clips: t.clips.filter((c) => c.id !== selected.clipId) } : t,
      ),
    }));
    setSelected(null);
  };

  const deleteClip = (trackId: string, clipId: string) => {
    // revoke any blob URLs owned by the clip being removed
    const track = project.tracks.find((t) => t.id === trackId);
    const clip = track ? track.clips.find((c) => c.id === clipId) : undefined;
    const linkedAssetIds =
      clip && clip.kind !== 'text' ? Array.from(new Set(clip.parts.map((p) => p.assetId).filter(Boolean) as string[])) : [];

    if (clip && clip.kind !== 'text') {
      for (const part of clip.parts) {
        try {
          URL.revokeObjectURL(part.objectUrl);
        } catch {
          /* ignore */
        }
      }
    }
    setProject((prev) => {
      return {
        ...prev,
        tracks: prev.tracks.map((t) => {
          // remove the requested clip
          let clips = t.id === trackId ? t.clips.filter((c) => c.id !== clipId) : t.clips;

          // if deleting a video clip, also remove the auto-added audio clip(s) for the same assetId(s)
          if (t.kind === 'audio' && track?.kind === 'video' && linkedAssetIds.length > 0) {
            const toRemove = new Set(linkedAssetIds);
            const removed: Clip[] = [];
            clips = clips.filter((c) => {
              if (c.kind === 'text' || c.kind !== 'audio') return true;
              if (c.parts.length !== 1) return true;
              const p0 = c.parts[0]!;
              const match = p0.assetId && toRemove.has(p0.assetId);
              if (match) removed.push(c);
              return !match;
            });
            for (const c of removed) {
              if (c.kind !== 'text') {
                for (const p of c.parts) {
                  try {
                    URL.revokeObjectURL(p.objectUrl);
                  } catch {
                    /* ignore */
                  }
                }
              }
            }
          }

          return t.id === trackId || (t.kind === 'audio' && track?.kind === 'video') ? { ...t, clips } : t;
        }),
      };
    });
    setSelected((s) => (s && s.trackId === trackId && s.clipId === clipId ? null : s));
  };

  const moveClip = (trackId: string, clipId: string, startSec: number) => {
    setProject((prev) => {
      const movedTrack = prev.tracks.find((t) => t.id === trackId);
      const movedClip = movedTrack ? movedTrack.clips.find((c) => c.id === clipId) : undefined;
      const assetIds =
        movedClip && movedClip.kind !== 'text'
          ? Array.from(new Set(movedClip.parts.map((p) => p.assetId).filter(Boolean) as string[]))
          : [];
      const isVideoMove = movedTrack?.kind === 'video';
      const isAudioMove = movedTrack?.kind === 'audio';

      return {
        ...prev,
        tracks: prev.tracks.map((t) => {
          // move the requested clip
          let clips = t.clips.map((c) => (t.id === trackId && c.id === clipId ? ({ ...c, startSec } as Clip) : c));

          // if moving a video clip, also move matching auto-added audio clip(s)
          if (isVideoMove && t.kind === 'audio' && assetIds.length > 0) {
            const setIds = new Set(assetIds);
            clips = clips.map((c) => {
              if (c.kind === 'text' || c.kind !== 'audio') return c;
              if (c.parts.length !== 1) return c;
              const p0 = c.parts[0]!;
              if (!p0.assetId || !setIds.has(p0.assetId)) return c;
              return { ...c, startSec } as Clip;
            });
          }

          // if moving an audio clip, also move matching video clip(s) that share the same asset id(s)
          if (isAudioMove && t.kind === 'video' && assetIds.length > 0) {
            const setIds = new Set(assetIds);
            clips = clips.map((c) => {
              if (c.kind === 'text') return c;
              if (c.kind !== 'video') return c;
              // Move any video clip that contains at least one part with a matching assetId.
              const has = c.parts.some((p) => p.assetId && setIds.has(p.assetId));
              if (!has) return c;
              return { ...c, startSec } as Clip;
            });
          }

          return t.id === trackId || (isVideoMove && t.kind === 'audio') || (isAudioMove && t.kind === 'video') ? { ...t, clips } : t;
        }),
      };
    });
  };

  const resizeClip = (trackId: string, clipId: string, edge: 'start' | 'end', startSec: number, endSec: number) => {
    const minDur = 0.1;
    setProject((prev) => {
      const movedTrack = prev.tracks.find((t) => t.id === trackId);
      const movedClip = movedTrack ? movedTrack.clips.find((c) => c.id === clipId) : undefined;
      const assetIds =
        movedClip && movedClip.kind !== 'text'
          ? Array.from(new Set(movedClip.parts.map((p) => p.assetId).filter(Boolean) as string[]))
          : [];
      const isVideoResize = movedTrack?.kind === 'video';
      const isAudioResize = movedTrack?.kind === 'audio';

      const applyResize = (c: Clip): Clip => {
        if (c.kind === 'text') {
          const nextStart = Math.max(0, startSec);
          const nextEnd = Math.max(nextStart + minDur, endSec);
          return { ...c, startSec: nextStart, durationSec: Math.max(minDur, nextEnd - nextStart) };
        }
        if (!c.parts || c.parts.length === 0) return c;
        const parts = [...c.parts];
        const next: typeof c = { ...c, parts } as any;

        if (edge === 'start') {
          const p0 = parts[0]!;
          const delta = Math.max(-p0.cropStartSec, Math.min((p0.cropEndSec - p0.cropStartSec) - minDur, startSec - c.startSec));
          const newStart = Math.max(0, c.startSec + delta);
          const newCropStart = Math.max(0, Math.min(p0.cropEndSec - minDur, p0.cropStartSec + delta));
          parts[0] = { ...p0, cropStartSec: newCropStart };
          (next as any).startSec = newStart;
          return next as Clip;
        }

        // edge === 'end'
        const lastIdx = parts.length - 1;
        const pn = parts[lastIdx]!;
        const curEnd = c.startSec + clipDurationSec(c);
        const deltaEnd = endSec - curEnd;
        let maxEnd = pn.sourceDurationSec || pn.cropEndSec;
        let newCropEnd = pn.cropEndSec + deltaEnd;
        if (c.kind === 'image') {
          // allow extending image duration by extending "source" duration too
          const newSource = Math.max(maxEnd, newCropEnd);
          maxEnd = newSource;
          parts[lastIdx] = { ...pn, cropEndSec: Math.max(pn.cropStartSec + minDur, Math.min(newCropEnd, maxEnd)), sourceDurationSec: newSource };
          return next as Clip;
        }
        newCropEnd = Math.max(pn.cropStartSec + minDur, Math.min(newCropEnd, maxEnd));
        parts[lastIdx] = { ...pn, cropEndSec: newCropEnd };
        return next as Clip;
      };

      const setIds = new Set(assetIds);
      return {
        ...prev,
        tracks: prev.tracks.map((t) => {
          let clips = t.clips;
          if (t.id === trackId) {
            clips = clips.map((c) => (c.id === clipId ? applyResize(c) : c));
          }
          // Keep linked auto-added audio/video in sync.
          if (assetIds.length > 0) {
            if (isVideoResize && t.kind === 'audio') {
              clips = clips.map((c) => {
                if (c.kind !== 'audio') return c;
                if (c.parts.length !== 1) return c;
                const p0 = c.parts[0]!;
                if (!p0.assetId || !setIds.has(p0.assetId)) return c;
                return applyResize(c);
              });
            }
            if (isAudioResize && t.kind === 'video') {
              clips = clips.map((c) => {
                if (c.kind !== 'video') return c;
                const has = c.parts.some((p) => p.assetId && setIds.has(p.assetId));
                if (!has) return c;
                return applyResize(c);
              });
            }
          }
          return t.id === trackId || (isVideoResize && t.kind === 'audio') || (isAudioResize && t.kind === 'video') ? { ...t, clips } : t;
        }),
      };
    });
  };

  const glueAndSelect = () => {
    if (!selected || !selectedTrack || !selectedClip) return;
    const res = canGlueWithNext(selectedTrack, selectedClip.id);
    if (!res.ok || !res.nextId) return;
    setProject((prev) => {
      const t = prev.tracks.find((x) => x.id === selected.trackId);
      if (!t) return prev;
      const nextId = res.nextId;
      if (!nextId) return prev;
      const glued = glueClips(t, selectedClip.id, nextId);
      // update selection after state update
      queueMicrotask(() => setSelected({ trackId: selected.trackId, clipId: glued.newClipId }));
      return { ...prev, tracks: prev.tracks.map((x) => (x.id === selected.trackId ? glued.track : x)) };
    });
  };

  return (
    <Layout headerPaddingClass="pt-24">
      <div className="w-full max-w-7xl 2xl:max-w-none mx-auto pb-[340px] space-y-6">
        <header className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Video Editor</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              MVP timeline editor with layers for video, audio, and text. Supports trimming (“crop”) and gluing adjacent clips.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addVideoWithAutoAudio(f);
                e.currentTarget.value = '';
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addMediaClip('image', f);
                e.currentTarget.value = '';
              }}
            />
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addMediaClip('audio', f);
                e.currentTarget.value = '';
              }}
            />
            <button type="button" className="btn btn-secondary" onClick={() => videoInputRef.current?.click()}>
              Add video
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void openGallery('video')}>
              From gallery
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => imageInputRef.current?.click()}>
              Add image
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void openGallery('image')}>
              From gallery
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => audioInputRef.current?.click()}>
              Add audio
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void openGallery('audio')}>
              From gallery
            </button>
            <button type="button" className="btn btn-secondary" onClick={addTextClip}>
              Add text
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isExporting || projectEndSec <= 0.05}
              onClick={() => void exportTimeline()}
              title={projectEndSec <= 0.05 ? 'Add at least one clip to export' : 'Export timeline to Media Gallery/Exports'}
            >
              {isExporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </header>

        {projectEndSec > 0.05 && (
          <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/40 bg-white/70 dark:bg-slate-900/30 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-semibold">Export settings</div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Video bitrate</label>
              <select
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-2 py-1 text-xs"
                value={String(exportVideoBps)}
                onChange={(e) => setExportVideoBps(Math.max(300_000, Number(e.target.value) || 2_500_000))}
                disabled={isExporting}
              >
                <option value="1200000">Low (1.2 Mbps)</option>
                <option value="2500000">Medium (2.5 Mbps)</option>
                <option value="5000000">High (5.0 Mbps)</option>
              </select>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Est. size: {(estimatedExportBytes / (1024 * 1024)).toFixed(1)}MB
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300">Output: MP4 (server-side)</div>
              {estimatedExportBytes > exportLimits.instagramMaxBytes ? (
                <div className="text-xs text-rose-700 dark:text-rose-200">
                  Estimated size exceeds Instagram’s limit (~{(exportLimits.instagramMaxBytes / (1024 * 1024)).toFixed(0)}MB).
                  <button type="button" className="ml-2 underline" onClick={autoReduceExportBitrateToFitInstagram} disabled={isExporting}>
                    Reduce bitrate to fit
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {mediaBusy && (
          <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/40 bg-white/70 dark:bg-slate-900/30 px-4 py-2 text-sm text-slate-700 dark:text-slate-200">
            {mediaBusy}
          </div>
        )}
        {playbackError && (
          <div className="rounded-lg border border-rose-200/70 dark:border-rose-800/60 bg-rose-50/80 dark:bg-rose-900/20 px-4 py-2 text-sm text-rose-800 dark:text-rose-200">
            Playback error: {playbackError}
          </div>
        )}
        {lastExportUrl && (
          <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/40 bg-white/70 dark:bg-slate-900/30 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="font-semibold">Export saved</span>
              {lastExportName ? <span className="text-slate-500 dark:text-slate-300"> — {lastExportName}</span> : null}
            </div>
            <a className="btn btn-secondary" href={lastExportUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        )}

        {galleryOpen && (
          <div className="fixed inset-0 z-[60]">
            <div className="absolute inset-0 bg-black/40" onClick={() => setGalleryOpen(false)} />
            <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-5xl px-4">
              <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200/60 dark:border-slate-700/50 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Media Gallery</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">Pick a {galleryKind} asset to add to the timeline.</div>
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => setGalleryOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="p-4 flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Folder</label>
                  <select
                    className="rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
                    value={galleryFolder}
                    onChange={(e) => setGalleryFolder(e.target.value)}
                  >
                    {galleryFolders.map((f) => (
                      <option key={f.id || '__root__'} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" className="btn btn-secondary" disabled={!gallerySelectedId} onClick={() => void addFromGallery()}>
                      Add selected
                    </button>
                  </div>
                </div>
                <div className="p-4 pt-0 max-h-[60vh] overflow-auto">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {galleryItems
                      .filter((x) => {
                        if (galleryKind === 'image') return x.kind === 'image';
                        if (galleryKind === 'audio') return x.kind === 'audio';
                        return x.kind === 'video';
                      })
                      .map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          className={[
                            'rounded-lg overflow-hidden border text-left',
                            gallerySelectedId === it.id
                              ? 'border-primary-400 ring-2 ring-primary-400'
                              : 'border-slate-200/70 dark:border-slate-700/60 hover:border-primary-300',
                          ].join(' ')}
                          onClick={() => setGallerySelectedId(it.id)}
                        >
                          <div className="w-full h-28 bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                            {it.kind === 'image' ? (
                              <img src={it.url} alt="" className="w-full h-full object-cover" />
                            ) : it.kind === 'video' ? (
                              <video src={it.url} className="w-full h-full object-cover" muted playsInline />
                            ) : it.kind === 'audio' ? (
                              <div className="text-xs text-slate-500 dark:text-slate-300">Audio</div>
                            ) : (
                              <div className="text-xs text-slate-500 dark:text-slate-400">File</div>
                            )}
                          </div>
                          <div className="p-2">
                            <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">{it.filename}</div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Preview */}
          <div className="lg:col-span-2 bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Preview (timeline)</div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">Playhead: {playheadSec.toFixed(2)}s</div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Format</label>
                  <select
                    className="rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
                    value={previewPreset}
                    onChange={(e) => setPreviewPreset(e.target.value)}
                  >
                    {previewPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="w-full">
                <div className="mx-auto w-full max-w-[520px]">
                  <div
                    className="rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-950/30 overflow-hidden relative shadow-inner"
                    style={{ aspectRatio: `${aspect.w} / ${aspect.h}` }}
                  >
                    {/* Canvas label */}
                    <div className="absolute top-2 left-2 z-10 text-[11px] px-2 py-1 rounded bg-black/40 text-white">
                      {aspect.w}:{aspect.h}
                    </div>

                    {!activeVisual ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-sm text-slate-600 dark:text-slate-300">No visual clip at the playhead.</div>
                      </div>
                    ) : activeVisual.kind === 'image' ? (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img
                        src={activeVisualMediaAtPlayhead?.part.objectUrl || activeVisualMediaClip?.parts[0]?.objectUrl}
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    ) : activeVisual.kind === 'video' ? (
                      <video
                        ref={videoPreviewRef}
                        className="absolute inset-0 w-full h-full object-contain bg-black"
                        muted={!useVideoAudio}
                        playsInline
                        preload="auto"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-sm text-slate-600 dark:text-slate-300">No visual clip at the playhead.</div>
                      </div>
                    )}

                    {/* Text overlay */}
                    {activeTextClips.length > 0 && (
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                        <div className="space-y-2 text-center">
                          {activeTextClips.map((c) => (
                            <div
                              key={c.id}
                              className="inline-block px-4 py-2 rounded-lg bg-black/55 text-white text-2xl font-extrabold tracking-tight"
                            >
                              {c.text || 'Text'}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {previewPreset === 'custom' && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Aspect W</label>
                        <input
                          className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                          type="number"
                          step="1"
                          min={1}
                          value={customAspectW}
                          onChange={(e) => setCustomAspectW(Math.max(1, safeNumber(e.target.value, 9)))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Aspect H</label>
                        <input
                          className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                          type="number"
                          step="1"
                          min={1}
                          value={customAspectH}
                          onChange={(e) => setCustomAspectH(Math.max(1, safeNumber(e.target.value, 16)))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Audio element for timeline playback */}
              <audio ref={audioPreviewRef} className="absolute w-0 h-0 opacity-0 pointer-events-none" preload="auto" />
            </div>

            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Timeline playback + export are MVP: export records a real-time preview into a video file and saves it to Media Gallery → <span className="font-semibold">Exports</span>.
            </div>
          </div>

          {/* Inspector */}
          <div className="bg-white/80 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Inspector</div>
              {selectedClip && (
                <button type="button" className="btn btn-ghost text-red-600 hover:text-red-700" onClick={deleteSelectedClip}>
                  Delete
                </button>
              )}
            </div>

            {!selectedClip ? (
              <div className="text-sm text-slate-600 dark:text-slate-300">No clip selected.</div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Selected</div>
                  <div className="text-sm text-slate-900 dark:text-slate-50">{describeClip(selectedClip)}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Start (sec)</label>
                    <input
                      className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                      value={selectedClip.startSec}
                      type="number"
                      step="0.1"
                      min={0}
                      onChange={(e) => updateSelectedClip({ startSec: Math.max(0, safeNumber(e.target.value, 0)) } as any)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Duration (sec)</label>
                    <input
                      className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/40 px-3 py-2 text-sm tabular-nums"
                      value={clipDurationSec(selectedClip).toFixed(2)}
                      disabled
                    />
                  </div>
                </div>

                {selectedClip.kind === 'text' ? (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Text</label>
                    <textarea
                      className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      rows={3}
                      value={selectedClip.text}
                      onChange={(e) => updateSelectedClip({ text: e.target.value } as any)}
                    />
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Text duration (sec)</label>
                    <input
                      className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                      type="number"
                      step="0.1"
                      min={0.1}
                      value={selectedClip.durationSec}
                      onChange={(e) => updateSelectedClip({ durationSec: Math.max(0.1, safeNumber(e.target.value, 3)) } as any)}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Trim / Crop</div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!glueNext.ok}
                        title={glueNext.ok ? 'Glue this clip with the next adjacent clip' : glueNext.reason}
                        onClick={glueAndSelect}
                      >
                        Glue with next
                      </button>
                    </div>

                    {selectedClip.parts.map((p, idx) => (
                      <div key={p.id} className="rounded-lg border border-slate-200/60 dark:border-slate-700/50 p-3 space-y-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{p.name}</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">In (sec)</label>
                            <input
                              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                              type="number"
                              step="0.1"
                              min={0}
                              max={p.cropEndSec}
                              value={p.cropStartSec}
                              onChange={(e) => {
                                const next = clamp(safeNumber(e.target.value, 0), 0, p.cropEndSec);
                                updateSelectedMediaPart(idx, { cropStartSec: next });
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Out (sec)</label>
                            <input
                              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                              type="number"
                              step="0.1"
                              min={p.cropStartSec}
                              max={p.sourceDurationSec}
                              value={p.cropEndSec}
                              onChange={(e) => {
                                const next = clamp(safeNumber(e.target.value, p.sourceDurationSec), p.cropStartSec, p.sourceDurationSec);
                                updateSelectedMediaPart(idx, { cropEndSec: next });
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          Source: {p.sourceDurationSec.toFixed(2)}s • Used: {(p.cropEndSec - p.cropStartSec).toFixed(2)}s
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="pt-3 border-t border-slate-200/60 dark:border-slate-700/40 space-y-2">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Add text settings</div>
              <input
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="Text…"
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Duration (sec)</label>
                  <input
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                    type="number"
                    step="0.1"
                    min={0.1}
                    value={textDuration}
                    onChange={(e) => setTextDuration(Math.max(0.1, safeNumber(e.target.value, 3)))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Zoom</label>
                  <input
                    className="w-full"
                    type="range"
                    min={30}
                    max={180}
                    value={pxPerSec}
                    onChange={(e) => setPxPerSec(clamp(safeNumber(e.target.value, 90), 30, 180))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Default image duration (sec)</label>
                  <input
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 tabular-nums"
                    type="number"
                    step="0.1"
                    min={0.1}
                    value={imageDuration}
                    onChange={(e) => setImageDuration(Math.max(0.1, safeNumber(e.target.value, 3)))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Tip</label>
                  <div className="text-xs text-slate-500 dark:text-slate-400 pt-2">
                    Images are added to the <span className="font-semibold">Video</span> track as duration-based clips.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom timeline */}
      <div className="fixed left-0 right-0 bottom-10 z-40 px-4 md:px-8">
        <div className="max-w-7xl 2xl:max-w-none mx-auto">
          <div className="h-64 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-900/70 backdrop-blur shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200/60 dark:border-slate-700/50">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Timeline (Video / Audio / Text)</div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">End: {projectEndSec.toFixed(2)}s</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => seekTo(0)}
                    title="First frame"
                  >
                    |&lt;
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const fps = Math.max(1, safeNumber(project.fps, 30));
                      const step = 1 / fps;
                      const curFrame = Math.round(playheadSec * fps);
                      seekTo(Math.max(0, (curFrame - 1) * step));
                    }}
                    title="Previous frame"
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const fps = Math.max(1, safeNumber(project.fps, 30));
                      const step = 1 / fps;
                      const curFrame = Math.round(playheadSec * fps);
                      seekTo((curFrame + 1) * step);
                    }}
                    title="Next frame"
                  >
                    &gt;
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const fps = Math.max(1, safeNumber(project.fps, 30));
                      const totalFrames = Math.max(1, Math.ceil(projectEndSec * fps));
                      const lastIndex = totalFrames - 1;
                      seekTo(lastIndex / fps);
                    }}
                    title="Last frame"
                  >
                    &gt;|
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsPlaying((v) => !v)}
                  title="Play/Pause (Space)"
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setIsPlaying(false);
                    seekTo(0);
                  }}
                >
                  Stop
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                  Clear selection
                </button>
              </div>
            </div>

            <VideoEditorTimeline
              project={project}
              pxPerSec={pxPerSec}
              playheadSec={playheadSec}
              isPlaying={isPlaying}
              selected={selected}
              onSelect={setSelected}
              onSetPlayhead={(t) => seekTo(t)}
              onDragTo={moveClip}
              onResizeClip={resizeClip}
              onDeleteClip={deleteClip}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};


