import type { PauseSpan, RecordingMetaInput } from '../../../../packages/core/event';
import { isUuid } from '../../record/project';

const SURFACES = new Set(['window', 'monitor', 'browser', 'unknown']);

export function recordingEnabled(flag: string | undefined): boolean {
  return flag === '1';
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const requestHost = request.headers.get('host') ?? new URL(request.url).host;
  return originHost.toLowerCase() === requestHost.toLowerCase();
}

export function recordingIdFromMetaUrl(raw: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/api\/recordings\/([^/]+)\/meta\/?$/);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isUuid(id) ? id.toLowerCase() : null;
}

export function parseGrantBody(body: unknown): { ok: true } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'consent is required' };
  const record = body as Record<string, unknown>;
  if (record.consent !== true) return { ok: false, error: 'consent is required' };
  if (record.mode !== 'window' && record.mode !== 'desktop') return { ok: false, error: 'a recording mode is required' };
  return { ok: true };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePauses(value: unknown, wallStart: number, wallEnd: number): PauseSpan[] | null {
  if (!Array.isArray(value)) return null;
  let cursor = wallStart;
  const pauses: PauseSpan[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const span = item as Record<string, unknown>;
    if (!finite(span.pause_ms) || !finite(span.resume_ms)) return null;
    if (span.pause_ms < cursor || span.resume_ms <= span.pause_ms || span.resume_ms > wallEnd) return null;
    pauses.push({ pause_ms: span.pause_ms, resume_ms: span.resume_ms });
    cursor = span.resume_ms;
  }
  return pauses;
}

export function parseMetaBody(body: unknown, urlId: string): { ok: true; meta: RecordingMetaInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'recording details are invalid' };
  const record = body as Record<string, unknown>;
  if (record.consent !== true) return { ok: false, error: 'consent is required' };
  if (typeof record.recording_id !== 'string' || record.recording_id.toLowerCase() !== urlId) {
    return { ok: false, error: 'recording id does not match' };
  }
  const mode = record.mode;
  if (mode !== 'window' && mode !== 'desktop') return { ok: false, error: 'a recording mode is required' };
  if (record.audio_tracks !== 0) return { ok: false, error: 'audio tracks must be absent' };
  if (record.video_tracks !== 1) return { ok: false, error: 'the take must contain one video track' };
  if (typeof record.display_surface !== 'string' || !SURFACES.has(record.display_surface)) {
    return { ok: false, error: 'display surface is invalid' };
  }
  if (mode === 'window' && record.display_surface === 'monitor') {
    return { ok: false, error: 'a full-screen share cannot be stored in window mode' };
  }
  if (!finite(record.wall_start_ms) || record.wall_start_ms < 0) return { ok: false, error: 'the take clock is invalid' };
  if (record.wall_end_ms == null) return { ok: false, error: 'the take must be stopped before it is stored' };
  if (!finite(record.wall_end_ms) || record.wall_end_ms < record.wall_start_ms) return { ok: false, error: 'the take clock is invalid' };
  const pauses = parsePauses(record.pauses, record.wall_start_ms, record.wall_end_ms);
  if (!pauses) return { ok: false, error: 'pauses must be ordered inside the take' };
  if (record.bytes != null && (!finite(record.bytes) || record.bytes < 0)) return { ok: false, error: 'recording details are invalid' };
  const meta: RecordingMetaInput = {
    recording_id: urlId,
    mode,
    display_surface: record.display_surface as RecordingMetaInput['display_surface'],
    consent: true,
    audio_tracks: 0,
    video_tracks: 1,
    wall_start_ms: record.wall_start_ms,
    wall_end_ms: record.wall_end_ms,
    pauses,
    bytes: record.bytes == null ? null : record.bytes,
  };
  return { ok: true, meta };
}
