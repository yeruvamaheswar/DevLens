import { describe, expect, it } from 'vitest';
import { idleTake, metaFromTake, pauseTake, resumeTake, startTake, stopTake } from './take';

describe('take clock', () => {
  it('stores a five-second pause and leaves the original state unchanged', () => {
    const started = startTake(idleTake(), 1_000, 'window');
    const paused = pauseTake(started, 6_000);
    const resumed = resumeTake(paused, 11_000);
    expect(started.phase).toBe('recording');
    expect(started.pauses).toEqual([]);
    expect(resumed.pauses).toEqual([{ pause_ms: 6_000, resume_ms: 11_000 }]);
    expect(resumed.pauses[0].resume_ms - resumed.pauses[0].pause_ms).toBe(5_000);
  });

  it('closes an open pause when the take stops', () => {
    const stopped = stopTake(pauseTake(startTake(idleTake(), 1_000, 'window'), 6_000), 11_000);
    expect(stopped.phase).toBe('review');
    expect(stopped.wallEndMs).toBe(11_000);
    expect(stopped.openPauseMs).toBeNull();
    expect(stopped.pauses).toEqual([{ pause_ms: 6_000, resume_ms: 11_000 }]);
  });

  it('keeps several pauses in order', () => {
    const first = resumeTake(pauseTake(startTake(idleTake(), 0, 'window'), 1_000), 2_000);
    const second = resumeTake(pauseTake(first, 4_000), 7_000);
    expect(second.pauses).toEqual([
      { pause_ms: 1_000, resume_ms: 2_000 },
      { pause_ms: 4_000, resume_ms: 7_000 },
    ]);
  });

  it('builds upload details only after stop', () => {
    const started = startTake(idleTake(), 1_000, 'window');
    expect(metaFromTake(started, 10, '00000000-0000-4000-8000-000000000001')).toBeNull();
    const meta = metaFromTake(stopTake(started, 2_000), 10, '00000000-0000-4000-8000-000000000001');
    expect(meta).toMatchObject({
      mode: 'window',
      consent: true,
      audio_tracks: 0,
      video_tracks: 1,
      wall_start_ms: 1_000,
      wall_end_ms: 2_000,
      bytes: 10,
    });
    expect(meta).not.toHaveProperty('recording_ref');
  });

  it('saves a desktop take as desktop and a window take as window', () => {
    const desktop = metaFromTake(
      stopTake(startTake(idleTake(), 1_000, 'monitor', 'desktop'), 2_000),
      10,
      '00000000-0000-4000-8000-000000000001',
    );
    expect(desktop).toMatchObject({ mode: 'desktop', display_surface: 'monitor', audio_tracks: 0, video_tracks: 1, consent: true });
    const windowTake = metaFromTake(
      stopTake(startTake(idleTake(), 1_000, 'window'), 2_000),
      10,
      '00000000-0000-4000-8000-000000000001',
    );
    expect(windowTake).toMatchObject({ mode: 'window', display_surface: 'window' });
  });
});
