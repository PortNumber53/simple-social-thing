import React, { useMemo, useRef, useState } from 'react';
import { clipDurationSec, clipEndSec, sortClipsByStart, type Clip, type Project, type Track } from './types';

export type SelectedClipRef = { trackId: string; clipId: string } | null;
export type ResizeEdge = 'start' | 'end';

function clipLabel(clip: Clip): string {
  if (clip.kind === 'text') return clip.text || 'Text';
  const n = clip.parts.length;
  if (n === 1) return clip.parts[0]?.name || 'Clip';
  return `${n} clips (glued)`;
}

function trackColor(track: Track): { bg: string; border: string; text: string } {
  if (track.kind === 'video') return { bg: 'bg-indigo-600/80', border: 'border-indigo-400/60', text: 'text-white' };
  if (track.kind === 'audio') return { bg: 'bg-emerald-600/80', border: 'border-emerald-400/60', text: 'text-white' };
  return { bg: 'bg-amber-500/80', border: 'border-amber-300/70', text: 'text-slate-900' };
}

export const VideoEditorTimeline: React.FC<{
  project: Project;
  pxPerSec: number;
  playheadSec: number;
  isPlaying: boolean;
  selected: SelectedClipRef;
  onSelect: (ref: SelectedClipRef) => void;
  onSetPlayhead: (t: number) => void;
  onDragTo: (trackId: string, clipId: string, startSec: number) => void;
  onResizeClip: (trackId: string, clipId: string, edge: ResizeEdge, startSec: number, endSec: number) => void;
  onDeleteClip: (trackId: string, clipId: string) => void;
}> = ({ project, pxPerSec, playheadSec, isPlaying, selected, onSelect, onSetPlayhead, onDragTo, onResizeClip, onDeleteClip }) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ trackId: string; clipId: string; startX: number; initialStartSec: number } | null>(null);
  const resizeRef = useRef<{
    trackId: string;
    clipId: string;
    edge: ResizeEdge;
    startX: number;
    initialStartSec: number;
    initialEndSec: number;
  } | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);

  const endSec = useMemo(() => {
    let max = 10;
    for (const t of project.tracks) for (const c of t.clips) max = Math.max(max, clipEndSec(c));
    return Math.ceil(max + 2);
  }, [project]);

  const timelineWidthPx = Math.max(900, Math.ceil(endSec * pxPerSec) + 240);

  const markerStepSec = useMemo(() => {
    if (pxPerSec >= 140) return 1;
    if (pxPerSec >= 80) return 2;
    if (pxPerSec >= 50) return 5;
    return 10;
  }, [pxPerSec]);

  const markers = useMemo(() => {
    const arr: number[] = [];
    for (let s = 0; s <= endSec; s += markerStepSec) arr.push(s);
    return arr;
  }, [endSec, markerStepSec]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Ruler */}
      <div className="flex items-stretch border-b border-slate-200/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-900/40">
        <div className="w-32 shrink-0 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 border-r border-slate-200/70 dark:border-slate-700/60">
          Timeline
        </div>
        <div
          ref={scrollerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden"
          onClick={(e) => {
            const el = e.currentTarget;
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left + el.scrollLeft;
            const sec = x / pxPerSec;
            onSetPlayhead(Math.max(0, sec));
          }}
        >
          <div className="relative h-10" style={{ width: timelineWidthPx }}>
            {markers.map((s) => {
              const x = s * pxPerSec;
              return (
                <div key={s} className="absolute top-0 bottom-0" style={{ left: x }}>
                  <div className="h-full w-px bg-slate-200 dark:bg-slate-700" />
                  <div className="absolute top-1 left-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {s}s
                  </div>
                </div>
              );
            })}
            <div className="absolute top-0 bottom-0 w-px bg-red-500" style={{ left: playheadSec * pxPerSec }} />
          </div>
        </div>
      </div>

      {/* Tracks */}
      <div className="flex-1 overflow-hidden">
        {project.tracks.map((track) => {
          const color = trackColor(track);
          const clips = [...track.clips].sort(sortClipsByStart);
          return (
            <div key={track.id} className="flex items-stretch border-b border-slate-200/60 dark:border-slate-700/50">
              <div className="w-32 shrink-0 px-3 py-2 border-r border-slate-200/70 dark:border-slate-700/60 bg-white/70 dark:bg-slate-900/30">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{track.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">{track.kind}</div>
              </div>
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div className="relative h-14" style={{ width: timelineWidthPx }}>
                  <div className="absolute inset-0 pointer-events-none">
                    {markers.map((s) => (
                      <div
                        key={s}
                        className="absolute top-0 bottom-0 w-px bg-slate-100 dark:bg-slate-800"
                        style={{ left: s * pxPerSec }}
                      />
                    ))}
                    <div className="absolute top-0 bottom-0 w-px bg-red-500/80" style={{ left: playheadSec * pxPerSec }} />
                  </div>

                  {clips.map((clip) => {
                    const dur = clipDurationSec(clip);
                    const left = clip.startSec * pxPerSec;
                    const width = Math.max(12, dur * pxPerSec);
                    const isSelected = !!selected && selected.trackId === track.id && selected.clipId === clip.id;
                    return (
                      <div
                        key={clip.id}
                        className={[
                          'group absolute top-2 h-10 rounded-md border shadow-sm text-left px-2 overflow-hidden',
                          color.bg,
                          color.border,
                          color.text,
                          isSelected ? 'ring-2 ring-primary-400' : 'hover:ring-2 hover:ring-white/30',
                          isSelected ? 'z-10' : 'z-0',
                          'select-none',
                        ].join(' ')}
                        style={{ left, width }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          const target = e.target as HTMLElement;
                          // If the press started on the delete "pill" (or anything inside it), don't select/drag.
                          if (target?.closest?.('[data-action="delete"]')) return;
                          e.stopPropagation();
                          onSelect({ trackId: track.id, clipId: clip.id });
                          if (isPlaying) return;
                          setIsInteracting(true);
                          // If the pointer is near the edges, treat it as trim/resize rather than move.
                          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                          const localX = e.clientX - rect.left;
                          const edgeHitPx = 10;
                          const initialStartSec = clip.startSec;
                          const initialEndSec = clipEndSec(clip);
                          if (localX <= edgeHitPx) {
                            dragRef.current = null;
                            resizeRef.current = { trackId: track.id, clipId: clip.id, edge: 'start', startX: e.clientX, initialStartSec, initialEndSec };
                          } else if (localX >= rect.width - edgeHitPx) {
                            dragRef.current = null;
                            resizeRef.current = { trackId: track.id, clipId: clip.id, edge: 'end', startX: e.clientX, initialStartSec, initialEndSec };
                          } else {
                            resizeRef.current = null;
                            dragRef.current = { trackId: track.id, clipId: clip.id, startX: e.clientX, initialStartSec: clip.startSec };
                          }
                          try {
                            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                          } catch {
                            /* ignore */
                          }
                        }}
                        onPointerMove={(e) => {
                          const rs = resizeRef.current;
                          if (rs && rs.trackId === track.id && rs.clipId === clip.id) {
                            const deltaSec = (e.clientX - rs.startX) / pxPerSec;
                            const minDur = 0.1;
                            if (rs.edge === 'start') {
                              const snapped = Math.round((rs.initialStartSec + deltaSec) * 10) / 10;
                              const nextStart = Math.max(0, Math.min(rs.initialEndSec - minDur, snapped));
                              onResizeClip(track.id, clip.id, 'start', nextStart, rs.initialEndSec);
                            } else {
                              const snapped = Math.round((rs.initialEndSec + deltaSec) * 10) / 10;
                              const nextEnd = Math.max(rs.initialStartSec + minDur, snapped);
                              onResizeClip(track.id, clip.id, 'end', rs.initialStartSec, nextEnd);
                            }
                            return;
                          }
                          const st = dragRef.current;
                          if (!st) return;
                          if (st.trackId !== track.id || st.clipId !== clip.id) return;
                          const deltaSec = (e.clientX - st.startX) / pxPerSec;
                          const snapped = Math.round((st.initialStartSec + deltaSec) * 10) / 10;
                          onDragTo(track.id, clip.id, Math.max(0, snapped));
                        }}
                        onPointerUp={() => {
                          dragRef.current = null;
                          resizeRef.current = null;
                          setIsInteracting(false);
                        }}
                        onPointerCancel={() => {
                          dragRef.current = null;
                          resizeRef.current = null;
                          setIsInteracting(false);
                        }}
                        title={`${clipLabel(clip)} • start ${clip.startSec.toFixed(2)}s • dur ${dur.toFixed(2)}s`}
                      >
                        <div className="relative h-full">
                          {/* Resize handles */}
                          {!isPlaying && (
                            <>
                              <div
                                data-action="resize-start"
                                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                  onSelect({ trackId: track.id, clipId: clip.id });
                                  setIsInteracting(true);
                                  if (isPlaying) return;
                                  const initialStartSec = clip.startSec;
                                  const initialEndSec = clipEndSec(clip);
                                  dragRef.current = null;
                                  resizeRef.current = { trackId: track.id, clipId: clip.id, edge: 'start', startX: e.clientX, initialStartSec, initialEndSec };
                                  try {
                                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                                title="Trim start"
                              />
                              <div
                                data-action="resize-end"
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                  onSelect({ trackId: track.id, clipId: clip.id });
                                  setIsInteracting(true);
                                  if (isPlaying) return;
                                  const initialStartSec = clip.startSec;
                                  const initialEndSec = clipEndSec(clip);
                                  dragRef.current = null;
                                  resizeRef.current = { trackId: track.id, clipId: clip.id, edge: 'end', startX: e.clientX, initialStartSec, initialEndSec };
                                  try {
                                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                                title="Trim end"
                              />
                            </>
                          )}
                          <div className="absolute top-1 right-3">
                            <button
                              type="button"
                              data-action="delete"
                              className={[
                                'opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity inline-flex items-center justify-center w-6 h-6 text-[12px] bg-black/25 hover:bg-black/35 rounded',
                                isInteracting ? 'pointer-events-none opacity-0' : '',
                              ].join(' ')}
                              onPointerDown={(e) => {
                                // Ensure drag/selection doesn't steal the interaction.
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isInteracting) return;
                                onDeleteClip(track.id, clip.id);
                              }}
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                          <div className="text-[12px] font-semibold truncate pr-6">{clipLabel(clip)}</div>
                          <div className="text-[10px] opacity-90 tabular-nums truncate">
                            {clip.startSec.toFixed(2)}s → {clipEndSec(clip).toFixed(2)}s
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


