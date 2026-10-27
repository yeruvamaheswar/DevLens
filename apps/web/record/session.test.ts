import { describe, expect, it } from 'vitest';
import { mediaOffsetMs } from '../../../packages/core/src/sync';
import { createRecorderSession, type CaptureRecorder, type CaptureStream, type CaptureTrack, type RecorderDeps } from './session';

type FakeTrack = CaptureTrack & { stopped: boolean; emitEnded: () => void };

function track(kind: string, settings: CaptureTrack['settings']): FakeTrack {
  const ended: Array<() => void> = [];
  const fake: FakeTrack = {
    kind,
    settings,
    stopped: false,
    stop() {
      fake.stopped = true;
      for (const listener of ended) listener();
    },
    addEventListener(_type, listener) { ended.push(listener); },
    emitEnded() { for (const listener of ended) listener(); },
  };
  return fake;
}

function recorder(): CaptureRecorder & { started: boolean } {
  let state: CaptureRecorder['state'] = 'inactive';
  const listeners: Record<'dataavailable' | 'stop', Array<(event: { data?: Blob }) => void>> = {
    dataavailable: [],
    stop: [],
  };
  return {
    started: false,
    get state() { return state; },
    start() { this.started = true; state = 'recording'; },
    pause() { state = 'paused'; },
    resume() { state = 'recording'; },
    stop() {
      state = 'inactive';
      const data = new Blob(['webm'], { type: 'video/webm' });
      for (const listener of listeners.dataavailable) listener({ data });
      for (const listener of listeners.stop) listener({});
    },
    addEventListener(type, listener) { listeners[type].push(listener); },
  };
}

function harness(options: {
  tracks: FakeTrack[];
  now: () => number;
  onPick?: () => void;
  upload?: RecorderDeps['upload'];
}) {
  const calls: unknown[] = [];
  const urls: string[] = [];
  const revoked: string[] = [];
  let created = 0;
  const uploads: Array<{ byteLength: number }> = [];
  const session = createRecorderSession({
    getDisplayMedia: async (constraints) => {
      calls.push(constraints);
      options.onPick?.();
      const stream: CaptureStream = { getTracks: () => options.tracks };
      return stream;
    },
    now: options.now,
    createRecorder: () => {
      created += 1;
      return recorder();
    },
    createObjectUrl: (blob) => {
      const url = `blob:${blob.size}`;
      urls.push(url);
      return url;
    },
    revokeObjectUrl: (url) => { revoked.push(url); },
    upload: options.upload ?? (async (input) => { uploads.push({ byteLength: input.blob.size }); }),
  });
  return { session, calls, urls, revoked, uploads, created: () => created };
}

describe('recorder session', () => {
  it('does not call getDisplayMedia until start', async () => {
    let time = 0;
    const { session, calls, created } = harness({ tracks: [track('video', { displaySurface: 'window' })], now: () => time });
    expect(session.snapshot().phase).toBe('idle');
    expect(calls).toEqual([]);
    expect(created()).toBe(0);
    time = 50;
    const pending = session.start();
    expect(session.snapshot().phase).toBe('arming');
    await pending;
    expect(calls).toEqual([{ video: true, audio: false }]);
    expect(session.snapshot().wallStartMs).toBe(50);
  });

  it('stamps wall_start_ms when the recorder starts, after the picker returns', async () => {
    let time = 100;
    const order: string[] = [];
    const { session } = harness({
      tracks: [track('video', { displaySurface: 'window' })],
      now: () => {
        order.push('now');
        return time;
      },
      onPick: () => {
        order.push('picker');
        time = 900;
      },
    });
    await session.start();
    expect(order[0]).toBe('picker');
    expect(order).toContain('now');
    expect(session.snapshot().wallStartMs).toBe(900);
  });

  it('stops every track and asks again when the share is a monitor, audio, a camera, or extra video', async () => {
    const cases = [
      { tracks: [track('video', { displaySurface: 'monitor' })], message: 'whole screen' },
      { tracks: [track('video', { displaySurface: 'window' }), track('audio', {})], message: 'microphone' },
      { tracks: [track('video', { displaySurface: 'window', facingMode: 'user' })], message: 'camera' },
      { tracks: [track('video', { displaySurface: 'window' }), track('video', { displaySurface: 'window' })], message: 'exactly one video' },
    ];
    for (const item of cases) {
      const { session, created } = harness({ tracks: item.tracks, now: () => 1 });
      await session.start();
      expect(item.tracks.every((entry) => entry.stopped)).toBe(true);
      expect(created()).toBe(0);
      expect(session.snapshot().phase).toBe('idle');
      expect(session.snapshot().message).toContain(item.message);
    }
  });

  it('excludes a five-second pause and closes the take on stop or when sharing ends', async () => {
    let time = 1_000;
    const video = track('video', { displaySurface: 'window' });
    const { session } = harness({ tracks: [video], now: () => time });
    await session.start();
    time = 6_000;
    session.pause();
    time = 11_000;
    session.resume();
    time = 16_000;
    session.stop();
    const snap = session.snapshot();
    expect(snap.phase).toBe('review');
    expect(snap.objectUrl).toMatch(/^blob:/);
    expect(snap.pauses).toEqual([{ pause_ms: 6_000, resume_ms: 11_000 }]);
    const clock = { wall_start_ms: snap.wallStartMs!, wall_end_ms: snap.wallEndMs, pauses: snap.pauses };
    expect(mediaOffsetMs(16_000, clock)).toBe(10_000);
    expect(mediaOffsetMs(8_000, clock)).toBeNull();

    let endedAt = 2_000;
    const endedTrack = track('video', { displaySurface: 'window' });
    const ended = harness({ tracks: [endedTrack], now: () => endedAt });
    await ended.session.start();
    endedAt = 4_000;
    endedTrack.emitEnded();
    expect(ended.session.snapshot().phase).toBe('review');
    expect(ended.session.snapshot().wallEndMs).toBe(4_000);
    expect(endedTrack.stopped).toBe(true);
  });

  it('can drop the preview before upload, and upload is a separate call', async () => {
    const { session, uploads, revoked } = harness({
      tracks: [track('video', { displaySurface: 'window' })],
      now: () => 5,
    });
    await session.start();
    session.stop();
    expect(uploads).toEqual([]);
    const url = session.snapshot().objectUrl;
    session.deleteTake();
    expect(uploads).toEqual([]);
    expect(revoked).toEqual([url]);
    expect(session.snapshot().phase).toBe('idle');
    expect(session.snapshot().objectUrl).toBeNull();
    await session.upload();
    expect(uploads).toEqual([]);
  });

  it('uploads only from review and leaves the take in place when upload fails', async () => {
    const token = 'upload-token-should-stay-out-of-the-status-line';
    const { session } = harness({
      tracks: [track('video', { displaySurface: 'window' })],
      now: () => 5,
      upload: async () => { throw new Error(token); },
    });
    await session.upload();
    expect(session.snapshot().phase).toBe('idle');
    await session.start();
    session.stop();
    await session.upload();
    expect(session.snapshot().phase).toBe('review');
    expect(session.snapshot().message).not.toContain(token);
    expect(session.snapshot().objectUrl).toBeTruthy();
  });

  it('discards a picker that resolves after the page is left', async () => {
    let resolvePick: (stream: CaptureStream) => void = () => {};
    const late = track('video', { displaySurface: 'window' });
    let created = 0;
    const session = createRecorderSession({
      getDisplayMedia: () => new Promise((resolve) => { resolvePick = resolve; }),
      now: () => 1,
      createRecorder: () => { created += 1; return recorder(); },
      createObjectUrl: () => 'blob:late',
      revokeObjectUrl: () => {},
      upload: async () => {},
    });
    const pending = session.start();
    session.dispose();
    resolvePick({ getTracks: () => [late] });
    await pending;
    expect(late.stopped).toBe(true);
    expect(created).toBe(0);
  });

  it('does not enter desktop mode from the window start', async () => {
    const monitor = track('video', { displaySurface: 'monitor' });
    const { session } = harness({ tracks: [monitor], now: () => 1 });
    await (session.start as (mode?: string) => Promise<void>)('desktop');
    expect(session.snapshot().phase).toBe('idle');
    expect(session.snapshot().mode).toBe('window');
    expect(session.snapshot().message).toContain('whole screen');
    expect(monitor.stopped).toBe(true);
  });

  it('keeps a monitor from the desktop start and labels the take desktop', async () => {
    const monitor = track('video', { displaySurface: 'monitor' });
    const { session, calls, created } = harness({ tracks: [monitor], now: () => 1 });
    const pending = session.startDesktop();
    expect(session.snapshot().message).toContain('other windows and notifications');
    expect(session.snapshot().message).toContain('Audio and camera stay off');
    expect(session.snapshot().message).toContain('delete the take before upload');
    await pending;
    expect(calls).toEqual([{ video: true, audio: false }]);
    expect(created()).toBe(1);
    expect(monitor.stopped).toBe(false);
    expect(session.snapshot().mode).toBe('desktop');
    expect(session.snapshot().displaySurface).toBe('monitor');
    session.stop();
    expect(session.snapshot().phase).toBe('review');
    expect(session.snapshot().mode).toBe('desktop');
    expect(session.snapshot().displaySurface).toBe('monitor');
  });

  it('keeps a window chosen during desktop mode and records that surface', async () => {
    const { session, calls } = harness({
      tracks: [track('video', { displaySurface: 'window' })],
      now: () => 1,
    });
    await session.startDesktop();
    expect(calls).toEqual([{ video: true, audio: false }]);
    expect(session.snapshot().phase).toBe('recording');
    expect(session.snapshot().mode).toBe('desktop');
    expect(session.snapshot().displaySurface).toBe('window');
    session.stop();
    expect(session.snapshot().mode).toBe('desktop');
    expect(session.snapshot().displaySurface).toBe('window');
  });

  it('discards audio and a camera track in desktop mode', async () => {
    const cases = [
      { tracks: [track('video', { displaySurface: 'monitor' }), track('audio', {})], message: 'microphone' },
      { tracks: [track('video', { displaySurface: 'monitor', facingMode: 'user' })], message: 'camera' },
    ];
    for (const item of cases) {
      const { session, calls, created } = harness({ tracks: item.tracks, now: () => 1 });
      await session.startDesktop();
      expect(calls).toEqual([{ video: true, audio: false }]);
      expect(item.tracks.every((entry) => entry.stopped)).toBe(true);
      expect(created()).toBe(0);
      expect(session.snapshot().phase).toBe('idle');
      expect(session.snapshot().mode).toBe('window');
      expect(session.snapshot().message).toContain(item.message);
    }
  });
});
