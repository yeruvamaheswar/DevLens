import type { Event, RecordingMeta } from '../event';

// Media time 0 is wall_start_ms. A pause is [pause_ms, resume_ms): the resume instant is recording again.
export function mediaOffsetMs(
  tsMs: number,
  m: Pick<RecordingMeta, 'wall_start_ms' | 'wall_end_ms' | 'pauses'>,
): number | null {
  if (!Number.isFinite(tsMs) || !Number.isFinite(m.wall_start_ms)) return null;
  if (tsMs < m.wall_start_ms) return null;
  if (m.wall_end_ms != null && (!Number.isFinite(m.wall_end_ms) || tsMs > m.wall_end_ms)) return null;
  let paused = 0;
  for (const span of m.pauses) {
    if (!Number.isFinite(span.pause_ms) || !Number.isFinite(span.resume_ms) || span.resume_ms < span.pause_ms) return null;
    if (tsMs >= span.pause_ms && tsMs < span.resume_ms) return null;
    if (span.resume_ms <= tsMs) paused += span.resume_ms - span.pause_ms;
  }
  return tsMs - m.wall_start_ms - paused;
}

export function attachMedia(events: readonly Event[], m: RecordingMeta): Event[] {
  return events.map((event) => {
    const offset = mediaOffsetMs(Date.parse(event.ts), m);
    if (offset == null) return { ...event, recording_ref: null, media_offset_ms: null };
    return { ...event, recording_ref: m.recording_ref, media_offset_ms: offset };
  });
}
