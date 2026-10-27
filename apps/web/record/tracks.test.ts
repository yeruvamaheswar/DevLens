import { describe, expect, it } from 'vitest';
import { assessTracks } from './tracks';

const video = (displaySurface?: string, facingMode?: string) => ({
  kind: 'video',
  settings: { displaySurface, facingMode },
});

describe('assessTracks', () => {
  it('keeps one window and rejects a monitor in window mode', () => {
    expect(assessTracks([video('window')], 'window')).toEqual({ ok: true, displaySurface: 'window' });
    expect(assessTracks([video('browser')], 'window')).toEqual({ ok: true, displaySurface: 'browser' });
    expect(assessTracks([video(undefined)], 'window')).toEqual({ ok: true, displaySurface: 'unknown' });
    expect(assessTracks([video('monitor')], 'window')).toEqual({ ok: false, reason: 'monitor' });
  });

  it('keeps a monitor only when the mode is desktop', () => {
    expect(assessTracks([video('monitor')], 'desktop')).toEqual({ ok: true, displaySurface: 'monitor' });
  });

  it('keeps the surface a desktop opt-in actually captured, and still rejects audio and camera', () => {
    expect(assessTracks([video('window')], 'desktop')).toEqual({ ok: true, displaySurface: 'window' });
    expect(assessTracks([video('browser')], 'desktop')).toEqual({ ok: true, displaySurface: 'browser' });
    expect(assessTracks([video(undefined)], 'desktop')).toEqual({ ok: true, displaySurface: 'unknown' });
    expect(assessTracks([video('monitor'), { kind: 'audio', settings: {} }], 'desktop')).toEqual({ ok: false, reason: 'audio' });
    expect(assessTracks([video('monitor', 'user')], 'desktop')).toEqual({ ok: false, reason: 'camera' });
    expect(assessTracks([video('monitor'), video('monitor')], 'desktop')).toEqual({ ok: false, reason: 'video-count' });
  });

  it('discards audio, a camera track, and any video count other than one', () => {
    expect(assessTracks([video('window'), { kind: 'audio', settings: {} }], 'window')).toEqual({ ok: false, reason: 'audio' });
    expect(assessTracks([video('window', 'user')], 'window')).toEqual({ ok: false, reason: 'camera' });
    expect(assessTracks([video('window'), video('window')], 'window')).toEqual({ ok: false, reason: 'video-count' });
    expect(assessTracks([], 'window')).toEqual({ ok: false, reason: 'video-count' });
  });
});
