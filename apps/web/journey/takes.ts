// Server only. Reads ingested takes (tables `takes` and `recordings`, plus `events` and `edges`) for the journey.
// Contract: plans/take-ingest-contract.md section 6. The server key reads; the private `recordings` bucket is never public.
// The store port is small so tests use a fake. Everything after the port is pure: rows in, journey and labels out.
import type { Edge, Event } from '../../../packages/core/event';
import { buildJourney, type JourneySourceMeta } from './build';

const EVENT_PAGE = 1000;

export const TAKE_BUCKET = 'recordings';
export const TAKE_SIGNED_URL_SECONDS = 900;
const PROJECT_HOST = 'hivfaqlabtbrhrviwrrm.supabase.co';
const TAKE_ID = /^[a-z0-9][a-z0-9-]{2,60}$/;
const EDGE_CHUNK = 25; // event ids are long; keep each `in (...)` query well under URL limits

export type TakeRow = {
  id: string;
  label: string;
  adapter: 'claude_code_hook' | 't3_code';
  capture_status: 'verified' | 'experimental';
  authorship: 'human' | 'scripted';
  authorship_note: string | null;
  scenario: string | null;
  session_ids: string[];
  analysis_status: 'complete' | 'partial' | 'missing' | 'failed';
  analysis_version: string;
  verification: 'rerun_passed' | 'rerun_failed' | 'none';
  coverage: { unknowns?: string[]; not_captured?: string[] } | null;
  recorded_at: string | null;
  ingested_at: string;
};

export type RecordingRow = {
  id: string;
  take_id: string;
  object_path: string;
  content_type: string;
  duration_ms: number;
  mode: 'window' | 'desktop';
  sync: { basis: string; uncertainty_ms?: number | null; anchors?: unknown[] | null };
  redaction: { spans?: number; verified?: { matches?: number } | null };
};

// The calls the journey needs. `getVisible` and `listVisible` return visible takes only.
export type TakeStore = {
  listVisible(): Promise<TakeRow[]>;
  getVisible(id: string): Promise<TakeRow | null>;
  events(sessionIds: string[]): Promise<Event[]>; // ordered by ts, seq
  edges(eventIds: string[]): Promise<Edge[]>; // edges whose src is one of these events
  recording(takeId: string): Promise<RecordingRow | null>;
  signedUrl(objectPath: string, seconds: number): Promise<string | null>;
};

// `take:<id>`. Anything that does not match the id pattern is refused.
export function takeId(key: string): string | null {
  if (!key.startsWith('take:')) return null;
  const id = key.slice(5);
  return TAKE_ID.test(id) ? id : null;
}

export function takeKey(id: string): string {
  return `take:${id}`;
}

// Null when the variables are missing or name another project. Callers treat null as "no takes".
// Every call times out, so a missing network never hangs the source list. Same rule as `captureBucketFromEnv`.
export function takeStoreFromEnv(env: Record<string, string | undefined> = process.env, timeoutMs = 5000): TakeStore | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== PROJECT_HOST) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
  // Opened on first use, so importing this file in a client bundle or in tests does not load the Supabase client.
  const open = async () => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(origin, secret, { auth: { persistSession: false }, global: { fetch: timedFetch } });
  };
  return {
    async listVisible() {
      const { data, error } = await (await open()).from('takes').select('*').eq('visible', true);
      if (error) throw new Error('The takes could not be listed.');
      return (data ?? []) as TakeRow[];
    },
    async getVisible(id) {
      const { data, error } = await (await open()).from('takes').select('*').eq('id', id).eq('visible', true).maybeSingle();
      if (error) throw new Error('The take could not be read.');
      return (data as TakeRow | null) ?? null;
    },
    async events(sessionIds) {
      const { data, error } = await (await open()).from('events').select('*').in('session_id', sessionIds).order('ts', { ascending: true }).order('seq', { ascending: true }).limit(EVENT_PAGE);
      if (error) throw new Error('The events could not be read.');
      // A full page may hide more rows (Supabase caps a read at 1000 by default). Refuse rather than show a cut-short take.
      if ((data ?? []).length >= EVENT_PAGE) throw new Error('The take has more events than one read returns.');
      return (data ?? []) as Event[];
    },
    async edges(eventIds) {
      const client = await open();
      const rows: Edge[] = [];
      for (let i = 0; i < eventIds.length; i += EDGE_CHUNK) {
        const { data, error } = await client.from('edges').select('*').in('src', eventIds.slice(i, i + EDGE_CHUNK));
        if (error) throw new Error('The edges could not be read.');
        rows.push(...((data ?? []) as Edge[]));
      }
      return rows;
    },
    async recording(takeId) {
      const { data, error } = await (await open()).from('recordings').select('*').eq('take_id', takeId).limit(1).maybeSingle();
      if (error) throw new Error('The recording could not be read.');
      return (data as RecordingRow | null) ?? null;
    },
    async signedUrl(objectPath, seconds) {
      const { data, error } = await (await open()).storage.from(TAKE_BUCKET).createSignedUrl(objectPath, seconds);
      return error || !data ? null : data.signedUrl;
    },
  };
}

// For the web routes. `DEVLENS_OFFLINE=1` on a local machine means no network, so no takes.
// Vercel sets VERCEL=1 and still reads takes, as `webCaptureBucket` does.
export function webTakeStore(env: Record<string, string | undefined> = process.env): TakeStore | null {
  if (env.DEVLENS_OFFLINE === '1' && !env.VERCEL) return null;
  return takeStoreFromEnv(env);
}

// One row per visible take. A failure lists no takes and the caller keeps the other sources.
export async function listTakeRows(store: TakeStore | null) {
  if (!store) return [];
  try {
    const takes = await store.listVisible();
    return takes.map((take) => ({
      key: takeKey(take.id),
      label: take.label,
      status: take.capture_status,
      adapter: take.adapter,
      at: take.recorded_at ?? take.ingested_at,
    }));
  } catch {
    return [];
  }
}

function recordingMeta(recording: RecordingRow) {
  const matches = recording.redaction?.verified?.matches;
  return {
    sync: {
      basis: recording.sync.basis,
      uncertainty_ms: typeof recording.sync.uncertainty_ms === 'number' ? recording.sync.uncertainty_ms : null,
      anchors: Array.isArray(recording.sync.anchors) ? recording.sync.anchors.length : 0,
    },
    redaction: { spans: recording.redaction?.spans ?? 0, matches: typeof matches === 'number' ? matches : 0 },
  };
}

const NOTES: Record<TakeRow['adapter'], string> = {
  claude_code_hook: 'Stored evidence from a Claude Code hook capture, read from private DevLens storage. Links between events come from fixed rules, not a model.',
  t3_code: 'Stored evidence read from the T3 Code server’s local store by the DevLens T3 adapter (experimental, read-only), kept in private DevLens storage. T3 records what each provider reported; DevLens did not hook the provider.',
};

export function takeSourceMeta(take: TakeRow, recording: RecordingRow | null): JourneySourceMeta {
  const key = takeKey(take.id);
  const meta = recording ? recordingMeta(recording) : null;
  return {
    key,
    label: take.label,
    adapter: take.adapter,
    status: take.capture_status,
    provenance_note: NOTES[take.adapter],
    unknowns: take.coverage?.unknowns ?? [],
    not_captured: take.coverage?.not_captured ?? [],
    media: recording ? { url: `/api/journey/media?source=${encodeURIComponent(key)}`, label: `${recording.mode === 'window' ? 'Window' : 'Desktop'} recording. Audio and camera off.` } : null,
    take: {
      authorship: take.authorship,
      authorship_note: take.authorship_note,
      analysis_status: take.analysis_status,
      verification: take.verification,
      sync: meta?.sync ?? null,
      redaction: meta?.redaction ?? null,
    },
  };
}

// Events are passed in already prepared for display (the caller strips raw payloads and paths).
export function takeResponse(take: TakeRow, recording: RecordingRow | null, events: Event[], edges: Edge[]) {
  const source = takeSourceMeta(take, recording);
  return { journey: buildJourney({ events, edges, source }), events, edges };
}

// Reads one visible take. Null when it is hidden, missing, or the key is not `take:<id>`.
export async function loadTake(key: string, store: TakeStore | null, prepare: (event: Event) => Event = (event) => event) {
  const id = takeId(key);
  if (!id || !store) return null;
  const take = await store.getVisible(id);
  if (!take) return null;
  const [events, recording] = await Promise.all([store.events(take.session_ids), store.recording(take.id)]);
  const edges = events.length ? await store.edges(events.map((event) => event.id)) : [];
  return takeResponse(take, recording, events.map(prepare), edges);
}

// The media route: 302 to a short-lived signed URL, or 404. The object path comes from the row, never from the request.
export async function takeMedia(key: string, store: TakeStore | null): Promise<Response> {
  const unavailable = () => new Response('Recording unavailable.', { status: 404 });
  const id = takeId(key);
  if (!id || !store) return unavailable();
  try {
    if (!(await store.getVisible(id))) return unavailable();
    const recording = await store.recording(id);
    const url = recording ? await store.signedUrl(recording.object_path, TAKE_SIGNED_URL_SECONDS) : null;
    if (!url) return unavailable();
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
  } catch {
    return unavailable();
  }
}

// Short, factual labels for /recruiter. Each line comes from a stored field; a gap is stated, never filled.
export function takeLabels(source: JourneySourceMeta, events: readonly Pick<Event, 'media_offset_ms'>[]): string[] {
  const take = source.take;
  if (!take) return [];
  const lines: string[] = [];
  if (take.authorship === 'scripted') {
    lines.push(`Scripted demo: the prompts and answers were typed by a script, not a developer.${take.authorship_note ? ` ${take.authorship_note}` : ''}`);
  }
  if (take.verification === 'none') lines.push('Independent re-run: not run for this take.');
  if (events.length === 0 || take.analysis_status === 'missing' || take.analysis_status === 'failed') {
    lines.push('Analysis not available for this recording.');
  } else if (take.analysis_status === 'partial') {
    lines.push(source.unknowns.length ? `Partial evidence: ${source.unknowns.join('; ')}` : 'Partial evidence.');
  }
  if (take.sync) {
    const seekable = events.some((event) => event.media_offset_ms != null);
    if (take.sync.basis === 'media_recorder' && seekable) {
      lines.push('Seek: exact (browser recording clock)');
    } else if (take.sync.basis === 'recorder_clock_calibrated' && seekable && take.sync.uncertainty_ms != null && take.sync.anchors >= 2) {
      lines.push(`Seek: ±${take.sync.uncertainty_ms / 1000} s (checked against ${take.sync.anchors} on-screen moments)`);
    } else {
      lines.push('Seek is off for this recording: its clock was not checked.');
    }
  }
  if (take.redaction) {
    lines.push(`Personal details blurred in the video (${take.redaction.spans} areas, checked by OCR).`);
    if (take.redaction.matches > 0) lines.push(`The OCR check still found ${take.redaction.matches} possible match${take.redaction.matches === 1 ? '' : 'es'} in the video.`);
  }
  return lines;
}
