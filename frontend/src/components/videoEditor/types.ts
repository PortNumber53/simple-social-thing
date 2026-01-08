export type TrackKind = 'video' | 'audio' | 'text';

export type ClipKind = TrackKind;

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaPart {
  id: string;
  kind: MediaKind;
  name: string;
  assetId?: string; // used to link video<->audio parts from the same imported file
  objectUrl: string;
  sourceDurationSec: number;
  cropStartSec: number;
  cropEndSec: number;
}

export interface MediaClip {
  id: string;
  kind: MediaKind;
  startSec: number;
  parts: MediaPart[];
}

export interface TextClip {
  id: string;
  kind: 'text';
  startSec: number;
  durationSec: number;
  text: string;
  // Normalized transform relative to the preview/export canvas.
  // x/y represent the center position, in [0..1] of the canvas width/height.
  // w/h represent the box size, in [0..1] of the canvas width/height.
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotationDeg?: number;
}

export type Clip = MediaClip | TextClip;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
}

export interface Project {
  id: string;
  fps: number;
  tracks: Track[];
}

export function makeId(prefix = 'id'): string {
  const rnd =
    typeof globalThis !== 'undefined' && globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? (globalThis.crypto.randomUUID() as string)
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${rnd}`;
}

export function clipDurationSec(c: Clip): number {
  if (c.kind === 'text') return Math.max(0, Number.isFinite(c.durationSec) ? c.durationSec : 0);
  return c.parts.reduce((sum, p) => sum + Math.max(0, p.cropEndSec - p.cropStartSec), 0);
}

export function clipEndSec(c: Clip): number {
  return c.startSec + clipDurationSec(c);
}

export function sortClipsByStart(a: Clip, b: Clip): number {
  if (a.startSec !== b.startSec) return a.startSec - b.startSec;
  return a.id.localeCompare(b.id);
}


