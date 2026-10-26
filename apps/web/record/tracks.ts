import type { RecordingMeta } from '../../../packages/core/event';

export type DisplaySurface = RecordingMeta['display_surface'];
export type CaptureMode = RecordingMeta['mode'];

export type TrackView = {
  kind: string;
  settings: { displaySurface?: string; facingMode?: string };
};

export type TrackRejection = 'audio' | 'camera' | 'video-count' | 'monitor';

export type TrackDecision =
  | { ok: true; displaySurface: DisplaySurface }
  | { ok: false; reason: TrackRejection };

export function displaySurfaceOf(value: string | undefined): DisplaySurface {
  if (value === 'window' || value === 'monitor' || value === 'browser') return value;
  return 'unknown';
}

export function assessTracks(tracks: readonly TrackView[], mode: CaptureMode): TrackDecision {
  const audio = tracks.filter((track) => track.kind === 'audio');
  const video = tracks.filter((track) => track.kind === 'video');
  if (audio.length > 0) return { ok: false, reason: 'audio' };
  if (video.some((track) => Boolean(track.settings.facingMode))) return { ok: false, reason: 'camera' };
  if (video.length !== 1) return { ok: false, reason: 'video-count' };
  const displaySurface = displaySurfaceOf(video[0].settings.displaySurface);
  if (mode === 'window' && displaySurface === 'monitor') return { ok: false, reason: 'monitor' };
  return { ok: true, displaySurface };
}

export function discardMessage(reason: TrackRejection): string {
  if (reason === 'audio') return 'The share included a microphone track. It was discarded. Start again and leave audio off.';
  if (reason === 'camera') return 'The share included a camera track. It was discarded.';
  if (reason === 'video-count') return 'The share did not contain exactly one video track. It was discarded.';
  return 'That share was the whole screen. Choose one window and start again.';
}
