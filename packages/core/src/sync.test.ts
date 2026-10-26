import { describe, expect, it } from 'vitest';
import type { Event, RecordingMeta } from '../event';
import { attachMedia, mediaOffsetMs } from './sync';

const FIVE_SECONDS = 5_000;

function meta(overrides: Partial<RecordingMeta> = {}): RecordingMeta {
  return {
    recording_id: '00000000-0000-4000-8000-000000000001',
    recording_ref: '00000000-0000-4000-8000-000000000001/take.webm',
    mode: 'window',
    display_surface: 'window',
    consent: true,
    audio_tracks: 0,
    video_tracks: 1,
    wall_start_ms: 0,
    wall_end_ms: 60_000,
    pauses: [],
    bytes: null,
    ...overrides,
  };
}

function event(tsMs: number, overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt',
    session_id: 'ses',
    project_id: 'broken-api',
    ts: new Date(tsMs).toISOString(),
    seq: 1,
    actor: 'developer',
    type: 'prompt',
    source: 'claude_code_hook',
    provenance: 'observed',
    recording_ref: 'previous.webm',
    media_offset_ms: 1,
    payload: { keep: true },
    ...overrides,
  };
}

describe('mediaOffsetMs', () => {
  it('does not add a 5 second pause to media_offset_ms', () => {
    const recording = meta({
      pauses: [{ pause_ms: 2_000, resume_ms: 2_000 + FIVE_SECONDS }],
    });
    const at = 20_000;
    expect(mediaOffsetMs(at, recording)).toBe(at - FIVE_SECONDS);
    expect(mediaOffsetMs(at, recording)).not.toBe(at);
  });

  it('returns null for an event inside a pause', () => {
    const recording = meta({ pauses: [{ pause_ms: 10_000, resume_ms: 15_000 }] });
    expect(mediaOffsetMs(10_000, recording)).toBeNull();
    expect(mediaOffsetMs(12_000, recording)).toBeNull();
    expect(mediaOffsetMs(14_999, recording)).toBeNull();
  });

  it('shifts an event after a completed pause by the paused time', () => {
    const recording = meta({ pauses: [{ pause_ms: 5_000, resume_ms: 10_000 }] });
    expect(mediaOffsetMs(10_000, recording)).toBe(5_000);
    expect(mediaOffsetMs(12_000, recording)).toBe(7_000);
  });

  it('subtracts every completed pause', () => {
    const recording = meta({
      pauses: [
        { pause_ms: 1_000, resume_ms: 2_000 },
        { pause_ms: 4_000, resume_ms: 7_000 },
      ],
    });
    expect(mediaOffsetMs(1_500, recording)).toBeNull();
    expect(mediaOffsetMs(3_000, recording)).toBe(2_000);
    expect(mediaOffsetMs(8_000, recording)).toBe(4_000);
    expect(mediaOffsetMs(5_000, recording)).toBeNull();
  });

  it('keeps events on an unfinished take and still drops a pause', () => {
    const recording = meta({
      wall_end_ms: null,
      pauses: [{ pause_ms: 4_000, resume_ms: 9_000 }],
    });
    expect(mediaOffsetMs(3_000, recording)).toBe(3_000);
    expect(mediaOffsetMs(6_000, recording)).toBeNull();
    expect(mediaOffsetMs(50_000, recording)).toBe(45_000);
  });

  it('returns null before the start and after the end', () => {
    const recording = meta({ wall_start_ms: 1_000, wall_end_ms: 5_000 });
    expect(mediaOffsetMs(999, recording)).toBeNull();
    expect(mediaOffsetMs(1_000, recording)).toBe(0);
    expect(mediaOffsetMs(5_000, recording)).toBe(4_000);
    expect(mediaOffsetMs(5_001, recording)).toBeNull();
  });
});

describe('attachMedia', () => {
  it('sets the recording ref and offset without mutating the input', () => {
    const recording = meta({ pauses: [{ pause_ms: 5_000, resume_ms: 10_000 }] });
    const inside = event(6_000, { id: 'inside' });
    const after = event(12_000, { id: 'after' });
    const input = [inside, after];
    const output = attachMedia(input, recording);

    expect(input[0]).toBe(inside);
    expect(inside.media_offset_ms).toBe(1);
    expect(inside.recording_ref).toBe('previous.webm');
    expect(inside.payload).toEqual({ keep: true });
    expect(output).not.toBe(input);
    expect(output[0]).toMatchObject({ id: 'inside', recording_ref: null, media_offset_ms: null });
    expect(output[1]).toMatchObject({
      id: 'after',
      recording_ref: recording.recording_ref,
      media_offset_ms: 7_000,
    });
    expect(output[1].payload).toBe(after.payload);
  });

  it('leaves a null ref when the take has not ended and the event is before it', () => {
    const recording = meta({ wall_start_ms: 10_000, wall_end_ms: null, pauses: [] });
    const output = attachMedia([event(9_000)], recording);
    expect(output[0].recording_ref).toBeNull();
    expect(output[0].media_offset_ms).toBeNull();
  });
});
