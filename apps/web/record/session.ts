import type { PauseSpan } from '../../../packages/core/event';
import { metaFromTake, pauseTake, resumeTake, startTake, stopTake, idleTake, type TakeState } from './take';
import { assessTracks, discardMessage, type CaptureMode, type DisplaySurface, type TrackView } from './tracks';

export type CaptureTrack = TrackView & {
  stop: () => void;
  addEventListener: (type: 'ended', listener: () => void) => void;
};

export type CaptureStream = {
  getTracks: () => CaptureTrack[];
};

export type CaptureRecorder = {
  state: 'inactive' | 'recording' | 'paused';
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  addEventListener: (type: 'dataavailable' | 'stop', listener: (event: { data?: Blob }) => void) => void;
};

export type UploadRequest = { blob: Blob; take: TakeState };

export type RecorderDeps = {
  getDisplayMedia: (constraints: { video: true; audio: false }) => Promise<CaptureStream>;
  now: () => number;
  createRecorder: (stream: CaptureStream) => CaptureRecorder;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  upload: (input: UploadRequest) => Promise<void>;
};

export type RecorderPhase = 'idle' | 'arming' | 'recording' | 'paused' | 'review' | 'uploading' | 'uploaded';

export type RecorderSnapshot = {
  phase: RecorderPhase;
  message: string;
  objectUrl: string | null;
  wallStartMs: number | null;
  wallEndMs: number | null;
  pauses: PauseSpan[];
  mode: CaptureMode;
  displaySurface: DisplaySurface | null;
};

export type RecorderSession = {
  start: () => Promise<void>;
  startDesktop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  deleteTake: () => void;
  upload: () => Promise<void>;
  snapshot: () => RecorderSnapshot;
  subscribe: (listener: (snapshot: RecorderSnapshot) => void) => () => void;
  dispose: () => void;
};

const DISPLAY_CONSTRAINTS = { video: true, audio: false } as const;

export function createRecorderSession(deps: RecorderDeps): RecorderSession {
  let phase: RecorderPhase = 'idle';
  let message = 'Nothing is recorded until you click Record one window or Record my desktop (second opt-in).';
  let take: TakeState = idleTake();
  let objectUrl: string | null = null;
  let blob: Blob | null = null;
  let stream: CaptureStream | undefined;
  let recorder: CaptureRecorder | undefined;
  let listener: ((snapshot: RecorderSnapshot) => void) | null = null;
  let generation = 0;

  function snapshot(): RecorderSnapshot {
    return {
      phase,
      message,
      objectUrl,
      wallStartMs: take.wallStartMs,
      wallEndMs: take.wallEndMs,
      pauses: take.pauses.map((span) => ({ ...span })),
      mode: take.mode,
      displaySurface: take.displaySurface,
    };
  }

  function emit() {
    listener?.(snapshot());
  }

  function dropPreview() {
    if (objectUrl) deps.revokeObjectUrl(objectUrl);
    objectUrl = null;
    blob = null;
  }

  function stopTracks(current: CaptureStream | undefined) {
    for (const track of current?.getTracks() ?? []) track.stop();
  }

  function finishBlob(chunks: Blob[]) {
    const next = new Blob(chunks, { type: 'video/webm' });
    chunks.length = 0;
    blob = next;
    if (objectUrl) deps.revokeObjectUrl(objectUrl);
    objectUrl = deps.createObjectUrl(next);
    emit();
  }

  function recordingMessage(mode: CaptureMode): string {
    if (mode === 'desktop') return 'Recording the desktop. Audio and camera stay off.';
    return 'Recording the chosen window. Audio and camera stay off.';
  }

  function stopRecording() {
    if (phase !== 'recording' && phase !== 'paused') return;
    phase = 'review';
    take = stopTake(take, deps.now());
    message = 'Play the take or delete it. Upload is a separate step.';
    const currentRecorder = recorder;
    const currentStream = stream;
    recorder = undefined;
    if (currentRecorder && currentRecorder.state !== 'inactive') currentRecorder.stop();
    stopTracks(currentStream);
    stream = undefined;
    emit();
  }

  async function arm(mode: CaptureMode) {
    if (phase !== 'idle') return;
    const current = ++generation;
    phase = 'arming';
    message = mode === 'desktop'
      ? 'A monitor take can show other windows and notifications. Audio and camera stay off. You can delete the take before upload.'
      : 'Choose one window. A full screen or a microphone share is discarded.';
    emit();
    let picked: CaptureStream;
    try {
      picked = await deps.getDisplayMedia(DISPLAY_CONSTRAINTS);
    } catch {
      if (current !== generation) return;
      phase = 'idle';
      message = 'Recording did not start.';
      emit();
      return;
    }
    if (current !== generation || phase !== 'arming') {
      stopTracks(picked);
      return;
    }
    const decision = assessTracks(picked.getTracks(), mode);
    if (!decision.ok) {
      stopTracks(picked);
      phase = 'idle';
      message = discardMessage(decision.reason);
      emit();
      return;
    }
    let created: CaptureRecorder;
    try {
      created = deps.createRecorder(picked);
    } catch {
      stopTracks(picked);
      phase = 'idle';
      message = 'Recording did not start.';
      emit();
      return;
    }
    const chunks: Blob[] = [];
    created.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    created.addEventListener('stop', () => finishBlob(chunks));
    const video = picked.getTracks().find((track) => track.kind === 'video');
    video?.addEventListener('ended', () => {
      if (generation === current) stopRecording();
    });
    const wallStartMs = deps.now();
    take = startTake(idleTake(), wallStartMs, decision.displaySurface, mode);
    stream = picked;
    recorder = created;
    phase = 'recording';
    try {
      created.start();
    } catch {
      if (phase === 'recording') {
        recorder = undefined;
        stream = undefined;
        take = idleTake();
        phase = 'idle';
        stopTracks(picked);
        message = 'Recording did not start.';
        emit();
      }
      return;
    }
    if (phase !== 'recording') return;
    message = recordingMessage(mode);
    emit();
  }

  return {
    snapshot,
    subscribe(next) {
      listener = next;
      next(snapshot());
      return () => {
        if (listener === next) listener = null;
      };
    },
    async start() {
      await arm('window');
    },
    async startDesktop() {
      await arm('desktop');
    },
    pause() {
      if (phase !== 'recording' || !recorder) return;
      recorder.pause();
      take = pauseTake(take, deps.now());
      phase = 'paused';
      message = 'Paused. Media time is not advancing.';
      emit();
    },
    resume() {
      if (phase !== 'paused' || !recorder) return;
      recorder.resume();
      take = resumeTake(take, deps.now());
      phase = 'recording';
      message = recordingMessage(take.mode);
      emit();
    },
    stop() {
      stopRecording();
    },
    deleteTake() {
      if (phase !== 'review') return;
      dropPreview();
      take = idleTake();
      phase = 'idle';
      message = 'Take deleted. Nothing was uploaded.';
      emit();
    },
    async upload() {
      if (phase !== 'review' || !blob) return;
      const currentBlob = blob;
      const currentTake = take;
      phase = 'uploading';
      message = 'Uploading the reviewed take to private storage.';
      emit();
      try {
        await deps.upload({ blob: currentBlob, take: currentTake });
        phase = 'uploaded';
        message = 'Uploaded to private storage. Replay can sign this object later.';
      } catch {
        phase = 'review';
        message = 'Upload failed. The take is still only on this device.';
      }
      emit();
    },
    dispose() {
      generation += 1;
      if (phase === 'recording' || phase === 'paused') stopRecording();
      dropPreview();
      listener = null;
    },
  };
}

export { metaFromTake };
