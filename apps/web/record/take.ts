import type { PauseSpan, RecordingMetaInput } from '../../../packages/core/event';
import type { CaptureMode, DisplaySurface } from './tracks';

export type TakePhase = 'idle' | 'recording' | 'paused' | 'review';

export type TakeState = {
  phase: TakePhase;
  mode: CaptureMode;
  wallStartMs: number | null;
  wallEndMs: number | null;
  pauses: PauseSpan[];
  openPauseMs: number | null;
  displaySurface: DisplaySurface | null;
};

export function idleTake(): TakeState {
  return {
    phase: 'idle',
    mode: 'window',
    wallStartMs: null,
    wallEndMs: null,
    pauses: [],
    openPauseMs: null,
    displaySurface: null,
  };
}

export function startTake(
  state: TakeState,
  now: number,
  displaySurface: DisplaySurface,
  mode: CaptureMode = 'window',
): TakeState {
  if (state.phase !== 'idle') return state;
  return {
    phase: 'recording',
    mode,
    wallStartMs: now,
    wallEndMs: null,
    pauses: [],
    openPauseMs: null,
    displaySurface,
  };
}

export function pauseTake(state: TakeState, now: number): TakeState {
  if (state.phase !== 'recording' || state.wallStartMs == null || now < state.wallStartMs) return state;
  return { ...state, phase: 'paused', openPauseMs: now, pauses: state.pauses.slice() };
}

export function resumeTake(state: TakeState, now: number): TakeState {
  if (state.phase !== 'paused' || state.openPauseMs == null) return state;
  const pauses = now > state.openPauseMs
    ? state.pauses.concat([{ pause_ms: state.openPauseMs, resume_ms: now }])
    : state.pauses.slice();
  return { ...state, phase: 'recording', openPauseMs: null, pauses };
}

export function stopTake(state: TakeState, now: number): TakeState {
  if (state.phase !== 'recording' && state.phase !== 'paused') return state;
  const pauses = state.openPauseMs != null && now > state.openPauseMs
    ? state.pauses.concat([{ pause_ms: state.openPauseMs, resume_ms: now }])
    : state.pauses.slice();
  return { ...state, phase: 'review', wallEndMs: now, openPauseMs: null, pauses };
}

export function metaFromTake(take: TakeState, bytes: number, recordingId: string): RecordingMetaInput | null {
  if (take.phase !== 'review' || take.wallStartMs == null || take.wallEndMs == null || take.displaySurface == null) return null;
  return {
    recording_id: recordingId,
    mode: take.mode,
    display_surface: take.displaySurface,
    consent: true,
    audio_tracks: 0,
    video_tracks: 1,
    wall_start_ms: take.wallStartMs,
    wall_end_ms: take.wallEndMs,
    pauses: take.pauses.map((span) => ({ ...span })),
    bytes,
  };
}
