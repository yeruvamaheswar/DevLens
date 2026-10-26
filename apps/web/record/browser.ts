import { uploadReviewedTake } from './upload';
import type { CaptureRecorder, CaptureStream, CaptureTrack, RecorderDeps } from './session';

const mediaStreams = new WeakMap<CaptureStream, MediaStream>();

function wrapTrack(track: MediaStreamTrack): CaptureTrack {
  const settings = track.getSettings() as { displaySurface?: string; facingMode?: string };
  return {
    kind: track.kind,
    settings: { displaySurface: settings.displaySurface, facingMode: settings.facingMode },
    stop: () => track.stop(),
    addEventListener: (type, listener) => track.addEventListener(type, listener),
  };
}

function wrapStream(media: MediaStream): CaptureStream {
  const wrapped: CaptureStream = { getTracks: () => media.getTracks().map(wrapTrack) };
  mediaStreams.set(wrapped, media);
  return wrapped;
}

function wrapRecorder(recorder: MediaRecorder): CaptureRecorder {
  return {
    get state() { return recorder.state; },
    start: () => recorder.start(),
    pause: () => recorder.pause(),
    resume: () => recorder.resume(),
    stop: () => recorder.stop(),
    addEventListener: (type, listener) => {
      if (type === 'dataavailable') {
        recorder.addEventListener('dataavailable', (event) => listener({ data: event.data }));
        return;
      }
      recorder.addEventListener('stop', () => listener({}));
    },
  };
}

export function browserDeps(): RecorderDeps {
  return {
    getDisplayMedia: async (constraints) => wrapStream(await navigator.mediaDevices.getDisplayMedia(constraints)),
    now: () => Date.now(),
    createRecorder: (stream) => {
      const media = mediaStreams.get(stream);
      if (!media) throw new Error('recording stream is unavailable');
      return wrapRecorder(new MediaRecorder(media));
    },
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    upload: (input) => uploadReviewedTake({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      blob: input.blob,
      take: input.take,
    }),
  };
}
