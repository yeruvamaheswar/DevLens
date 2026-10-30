import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { Edge, Event, RecordingMeta } from '../../core/event';
import { attachMedia } from '../../core/src/sync';
import { secretValuesFromEnv } from '../../capture/redact';
import { dedupeEvents } from '../../link/src/rules';
import { assertTracerProject, edgeRow, eventRow, isMissingFunction, planSession, readJsonl, type Loaded } from './link';

// Take ingest (plans/take-ingest-contract.md, sections 3 to 5). One manifest entry becomes one take row, the events
// and edges of its sessions, and at most one recording row, written by public.replace_take in one transaction.
//   npm run ingest -- --dry-run [--take <id> | --all]   no network, no client; prints the plan
//   npm run ingest -- --take <id>                        upload + replace_take; visible stays false
//   npm run ingest -- --take <id> --publish              also sets visible = true; refuses without content_reviewed_at
// Storage and the database sit behind small ports, so tests use fakes.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MANIFEST = path.join(repoRoot, 'ingest', 'takes.manifest.json');
export const BUCKET = 'recordings';
export const MAX_BYTES = 52428800;
const TAKE_ID = /^[a-z0-9][a-z0-9-]{2,60}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9']);
const SIGNED_URL_SECONDS = 60;
// The linker and the T3 capture name their rules in edges.derived_by; this names how the edge set was produced.
const ANALYSIS_VERSION = { linker: 'devlens-link-rules-v1', edgesFile: 't3-capture-edges-v1' } as const;

export type SyncBasis = 'media_recorder' | 'recorder_clock_calibrated' | 'recorder_timeline_uncalibrated';
export type Anchor = { event_id: string; expected_video_s: number; observed_video_s: number };
export type SyncSpec = { basis: SyncBasis; wall_start_ms: number | null; uncertainty_ms: number | null; anchors: Anchor[] };
export type RedactionSpec = {
  method: string; spans: number | null;
  verified: { fps: number | null; offset_s: number | null; pattern: string | null; matches: number | null };
  residual_note?: string | null;
};
export type RecordingSpec = {
  id: string; playback: string; source: string; source_sha256: string;
  mode: 'window' | 'desktop'; consent: true; sync: SyncSpec; redaction: RedactionSpec;
};
export type TakeSpec = {
  id: string; label: string; adapter: 'claude_code_hook' | 't3_code'; capture_status: 'verified' | 'experimental';
  authorship: 'human' | 'scripted'; authorship_note: string | null; scenario: string | null;
  session_ids: string[]; events: string[]; edges: string | null; rerun: string | null;
  coverage: { unknowns: string[]; not_captured: string[] };
  verification: 'rerun_passed' | 'rerun_failed' | 'none';
  expected: { events: number };
  recording: RecordingSpec | null;
  content_reviewed_at: string | null;
};

// ---- Ports ----
export type ProbeResult = { video_codec: string | null; audio_streams: number; duration_ms: number; width: number | null; height: number | null };
export type Probe = (file: string) => Promise<ProbeResult>;
export type RecordingStore = {
  // Upload with upsert false. 'exists' when an object is already at that path; nothing is overwritten.
  upload(object: string, body: Buffer, contentType: string): Promise<'created' | 'exists'>;
  // Size in bytes of the listed object, or null when the listing does not show it.
  size(object: string): Promise<number | null>;
  signedUrl(object: string, seconds: number): Promise<string | null>;
};
export type RangeProbe = (url: string) => Promise<number>;
export type Counts = { events: number; edges: number; recordings: number };
export type TakeDb = {
  replaceTake(args: { p_take: unknown; p_recording: unknown; p_events: unknown; p_edges: unknown }): Promise<Counts>;
  counts(takeId: string, sessionIds: readonly string[], edgeIds: readonly string[]): Promise<Counts>;
  setVisible(takeId: string): Promise<void>;
};
export type LiveDeps = { store: RecordingStore; db: TakeDb; range: RangeProbe };

// ---- Plan ----
export type TakeRow = Omit<TakeSpec, 'events' | 'edges' | 'rerun' | 'expected' | 'recording'> & {
  analysis_status: 'complete' | 'partial' | 'missing' | 'failed'; analysis_version: string; recorded_at: string | null;
};
export type RecordingRow = {
  id: string; bucket: string; object_path: string; content_type: 'video/mp4'; bytes: number; sha256: string;
  source_sha256: string; source_bytes: number; duration_ms: number; width: number | null; height: number | null;
  mode: 'window' | 'desktop'; consent: true; audio_tracks: 0; sync: SyncSpec; redaction: RedactionSpec;
};
export type Playback = { file: string; bytes: number; sha256: string; probe: ProbeResult; object_path: string };
export type TakePlan = {
  id: string;
  take: TakeRow;
  events: ReturnType<typeof eventRow>[];
  edges: ReturnType<typeof edgeRow>[];
  recording: RecordingRow | null;
  playback: Playback | null;
  sync_basis: SyncBasis | null;
  seek: { enabled: boolean; reason: string };
  offsets: number;
  // Reasons the take cannot go live yet. Dry-run reports them and continues.
  blockers: string[];
};
export type PlanOptions = { root?: string; home?: string; probe?: Probe; secrets?: readonly string[] };

export class IngestError extends Error {}

function fail(take: string, message: string): never {
  throw new IngestError(`${take}: ${message}`);
}

// ---- Manifest validation ----
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);

function validateSync(id: string, sync: unknown): SyncSpec {
  const s = sync as Partial<SyncSpec> | null;
  if (!s || typeof s !== 'object') fail(id, 'recording.sync is missing');
  if (!oneOf(s.basis, ['media_recorder', 'recorder_clock_calibrated', 'recorder_timeline_uncalibrated'] as const)) fail(id, 'recording.sync.basis is not a known basis');
  if (!(s.wall_start_ms === null || isNum(s.wall_start_ms))) fail(id, 'recording.sync.wall_start_ms must be a number or null');
  if (!(s.uncertainty_ms === null || (isNum(s.uncertainty_ms) && s.uncertainty_ms >= 0))) fail(id, 'recording.sync.uncertainty_ms must be a number >= 0 or null');
  if (!Array.isArray(s.anchors) || !s.anchors.every((a) => a && isStr(a.event_id) && isNum(a.expected_video_s) && isNum(a.observed_video_s))) {
    fail(id, 'recording.sync.anchors must list { event_id, expected_video_s, observed_video_s }');
  }
  if (s.basis !== 'recorder_timeline_uncalibrated' && !isNum(s.wall_start_ms)) fail(id, `recording.sync.wall_start_ms is required for ${s.basis}`);
  if (s.basis === 'media_recorder' && s.uncertainty_ms !== 0) fail(id, 'recording.sync.uncertainty_ms must be 0 for media_recorder');
  if (s.basis === 'recorder_clock_calibrated' && !isNum(s.uncertainty_ms)) fail(id, 'recording.sync.uncertainty_ms is required for recorder_clock_calibrated');
  return s as SyncSpec;
}

function validateRedaction(id: string, redaction: unknown): RedactionSpec {
  const r = redaction as Partial<RedactionSpec> | null;
  if (!r || typeof r !== 'object' || !isStr(r.method)) fail(id, 'recording.redaction.method is missing');
  if (!(r.spans === null || (Number.isInteger(r.spans) && (r.spans as number) >= 0))) fail(id, 'recording.redaction.spans must be an integer >= 0 or null');
  const v = r.verified;
  if (!v || typeof v !== 'object') fail(id, 'recording.redaction.verified is missing');
  if (!(v.matches === null || (Number.isInteger(v.matches) && (v.matches as number) >= 0))) fail(id, 'recording.redaction.verified.matches must be an integer >= 0 or null');
  if (!(v.fps === null || isNum(v.fps)) || !(v.offset_s === null || isNum(v.offset_s)) || !isStrOrNull(v.pattern)) fail(id, 'recording.redaction.verified has a bad fps, offset_s, or pattern');
  if (r.residual_note !== undefined && !isStrOrNull(r.residual_note)) fail(id, 'recording.redaction.residual_note must be a string or null');
  return r as RedactionSpec;
}

export function validateTake(raw: unknown): TakeSpec {
  const t = raw as Partial<TakeSpec> | null;
  if (!t || typeof t !== 'object') throw new IngestError('Manifest entry is not an object');
  const id = typeof t.id === 'string' ? t.id : '(no id)';
  if (!isStr(t.id) || !TAKE_ID.test(t.id)) fail(id, 'id must be lowercase letters, digits, and dashes (3 to 61 characters)');
  if (!isStr(t.label)) fail(id, 'label is missing');
  if (!oneOf(t.adapter, ['claude_code_hook', 't3_code'] as const)) fail(id, 'adapter must be claude_code_hook or t3_code');
  if (!oneOf(t.capture_status, ['verified', 'experimental'] as const)) fail(id, 'capture_status must be verified or experimental');
  if (!oneOf(t.authorship, ['human', 'scripted'] as const)) fail(id, 'authorship must be human or scripted');
  if (!isStrOrNull(t.authorship_note) || !isStrOrNull(t.scenario)) fail(id, 'authorship_note and scenario must be strings or null');
  if (!isStrList(t.session_ids) || t.session_ids.length === 0 || !t.session_ids.every(isStr)) fail(id, 'session_ids must list at least one session');
  if (!isStrList(t.events) || t.events.length === 0 || !t.events.every(isStr)) fail(id, 'events must list at least one file');
  if (!(t.edges === null || isStr(t.edges))) fail(id, 'edges must be null (run the linker) or a file');
  if (!(t.rerun === null || t.rerun === undefined || isStr(t.rerun))) fail(id, 'rerun must be null or a file');
  if (t.adapter === 'claude_code_hook' && t.edges !== null) fail(id, 'Claude Code takes use the linker: edges must be null');
  if (t.adapter === 't3_code' && t.edges === null) fail(id, 'T3 takes take edges from their capture: edges must name a file');
  const c = t.coverage;
  if (!c || !isStrList(c.unknowns) || !isStrList(c.not_captured)) fail(id, 'coverage must have unknowns and not_captured lists');
  if (!oneOf(t.verification, ['rerun_passed', 'rerun_failed', 'none'] as const)) fail(id, 'verification must be rerun_passed, rerun_failed, or none');
  if (!t.expected || !Number.isInteger(t.expected.events) || t.expected.events < 0) fail(id, 'expected.events must be an integer');
  if (!(t.content_reviewed_at === null || (isStr(t.content_reviewed_at) && Number.isFinite(Date.parse(t.content_reviewed_at))))) {
    fail(id, 'content_reviewed_at must be an ISO time or null');
  }
  let recording: RecordingSpec | null = null;
  if (t.recording !== null) {
    const r = t.recording as Partial<RecordingSpec> | undefined;
    if (!r || typeof r !== 'object') fail(id, 'recording must be an object or null');
    if (!isStr(r.id) || !isStr(r.playback) || !isStr(r.source)) fail(id, 'recording needs id, playback, and source');
    if (path.extname(r.playback).toLowerCase() !== '.mp4') fail(id, 'recording.playback must be an .mp4 file (the object path ends in .mp4)');
    if (!isStr(r.source_sha256) || !SHA256.test(r.source_sha256)) fail(id, 'recording.source_sha256 must be 64 lowercase hex characters');
    if (!oneOf(r.mode, ['window', 'desktop'] as const)) fail(id, 'recording.mode must be window or desktop');
    if (r.consent !== true) fail(id, 'recording.consent must be true');
    recording = { ...(r as RecordingSpec), sync: validateSync(id, r.sync), redaction: validateRedaction(id, r.redaction) };
  }
  return { ...(t as TakeSpec), rerun: t.rerun ?? null, recording };
}

export async function readManifest(file = MANIFEST): Promise<TakeSpec[]> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch { throw new IngestError(`Cannot read the manifest ${path.basename(file)}`); }
  const takes = (parsed as { takes?: unknown } | null)?.takes;
  if (!Array.isArray(takes)) throw new IngestError('The manifest has no takes list');
  const specs = takes.map(validateTake);
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) throw new IngestError(`The manifest lists take ${spec.id} twice`);
    seen.add(spec.id);
  }
  return specs;
}

// Manifest paths are `~/...` or repo-relative, so the committed file names no home directory.
export function resolvePath(take: string, file: string, root: string, home: string): string {
  if (file === '~' || file.startsWith('~/')) return path.join(home, file.slice(1));
  if (path.isAbsolute(file)) fail(take, `manifest paths must start with ~/ or be repo-relative: ${path.basename(file)}`);
  return path.resolve(root, file);
}

// ---- Seek rule (section 4) ----
export function seekDecision(sync: SyncSpec): { enabled: boolean; reason: string } {
  if (sync.basis === 'media_recorder') return { enabled: true, reason: 'browser recording clock' };
  if (sync.basis === 'recorder_timeline_uncalibrated') return { enabled: false, reason: 'clock not calibrated' };
  const limit = sync.uncertainty_ms ?? 0;
  if (sync.anchors.length < 2) return { enabled: false, reason: `calibration needs 2 anchors, has ${sync.anchors.length}` };
  const off = sync.anchors.filter((a) => Math.abs(a.observed_video_s - a.expected_video_s) * 1000 > limit);
  if (off.length > 0) return { enabled: false, reason: `${off.length} anchor(s) outside ±${limit} ms` };
  return { enabled: true, reason: `${sync.anchors.length} anchors within ±${limit} ms` };
}

// ---- Scrub and secret guard (section 5, step 4) ----
const USERS_PREFIX = /\/Users\/[^/\s"'`\\]+/g;

export function scrubString(text: string, home: string): string {
  const out = home.length > 1 ? text.split(home).join('~') : text;
  return out.replace(USERS_PREFIX, '~');
}

export function scrubValue<T>(value: T, home: string): T {
  if (typeof value === 'string') return scrubString(value, home) as T;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, home)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[scrubString(key, home)] = scrubValue(item, home);
    return out as T;
  }
  return value;
}

export function assertNoSecrets(take: string, payload: unknown, secrets: readonly string[]): void {
  const text = JSON.stringify(payload);
  if (text.includes('sb_secret_') || secrets.some((value) => value.length >= 8 && text.includes(value))) {
    fail(take, 'the payload contains a secret value. Nothing was sent.');
  }
}

// ---- Media facts (section 5, step 5) ----
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export const ffprobe: Probe = (file) => new Promise((resolve, reject) => {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', file],
    { maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) { reject(new Error(`ffprobe could not read ${path.basename(file)}`)); return; }
      try {
        const parsed = JSON.parse(stdout) as { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[]; format?: { duration?: string } };
        const streams = parsed.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        resolve({
          video_codec: video?.codec_name ?? null,
          audio_streams: streams.filter((s) => s.codec_type === 'audio').length,
          duration_ms: Math.round(Number(parsed.format?.duration) * 1000),
          width: video?.width ?? null,
          height: video?.height ?? null,
        });
      } catch { reject(new Error(`ffprobe output for ${path.basename(file)} is not JSON`)); }
    });
});

export function objectPath(takeId: string, sha256: string): string {
  return `takes/${takeId}/${sha256.slice(0, 12)}.mp4`;
}

// ---- Edge file reading (same pattern as readJsonl in link.ts) ----
async function readEdges(take: string, file: string): Promise<Edge[]> {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { fail(take, `cannot read ${path.basename(file)}`); }
  const edges: Edge[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { fail(take, `edge line ${i + 1} is not JSON`); }
    const edge = parsed as Edge | null;
    if (!edge || typeof edge !== 'object' || !isStr(edge.id) || !isStr(edge.src) || !isStr(edge.dst) || !isStr(edge.rel) || !isStr(edge.derived_by) || !Array.isArray(edge.evidence_event_ids)) {
      fail(take, `edge line ${i + 1} is missing id, src, dst, rel, derived_by, or evidence_event_ids`);
    }
    edges.push(edge);
  }
  return edges;
}

function withMedia(loaded: Loaded[], meta: RecordingMeta | null): Loaded[] {
  if (!meta) return loaded.map((item) => ({ ...item, event: { ...item.event, recording_ref: null, media_offset_ms: null } }));
  const attached = attachMedia(loaded.map((item) => item.event), meta);
  return loaded.map((item, i) => ({ ...item, event: attached[i] }));
}

function clearMedia(loaded: Loaded[]): Loaded[] {
  return withMedia(loaded, null);
}

// Validates and prepares one take. Hard errors throw; reasons it cannot go live yet go in blockers.
export async function planTake(spec: TakeSpec, options: PlanOptions = {}): Promise<TakePlan> {
  const root = options.root ?? repoRoot;
  const home = options.home ?? homedir();
  const probe = options.probe ?? ffprobe;
  const id = spec.id;
  const blockers: string[] = [];
  const resolve = (file: string) => resolvePath(id, file, root, home);

  // Step 2: events. Every session_id is one of the take's; the count matches the manifest.
  const sessions = new Set(spec.session_ids);
  let sessionLoaded: Loaded[] = [];
  for (const file of spec.events) {
    try { sessionLoaded = sessionLoaded.concat(await readJsonl(resolve(file), sessionLoaded.length)); } catch (error) {
      fail(id, error instanceof Error ? error.message : 'cannot read events');
    }
  }
  let rerunLoaded: Loaded[] = [];
  if (spec.rerun) {
    try { rerunLoaded = await readJsonl(resolve(spec.rerun), sessionLoaded.length); } catch (error) {
      fail(id, error instanceof Error ? `rerun: ${error.message}` : 'cannot read the rerun file');
    }
  }
  for (const { event } of [...sessionLoaded, ...rerunLoaded]) {
    if (!sessions.has(event.session_id)) fail(id, `event ${event.id} belongs to a session the take does not list`);
  }
  if (sessionLoaded.length !== spec.expected.events) fail(id, `expected ${spec.expected.events} events, read ${sessionLoaded.length}`);

  const rerunStatuses = rerunLoaded.map(({ event }) => (event.payload as { status?: unknown }).status);
  if (spec.verification === 'none' && rerunLoaded.length > 0) fail(id, 'verification is none, but a rerun file is given');
  if (spec.verification !== 'none' && rerunLoaded.length === 0) fail(id, `verification is ${spec.verification}, but there are no rerun events`);
  if (spec.verification === 'rerun_passed' && !rerunStatuses.every((s) => s === 'passed')) fail(id, 'verification is rerun_passed, but a rerun did not pass');
  if (spec.verification === 'rerun_failed' && !rerunStatuses.some((s) => s === 'failed')) fail(id, 'verification is rerun_failed, but no rerun failed');

  // Step 5 runs before step 3 here: the object path and duration that the offsets need come from the playback file.
  let playback: Playback | null = null;
  let sourceBytes = 0;
  const seek = spec.recording ? seekDecision(spec.recording.sync) : { enabled: false, reason: 'no recording' };
  if (spec.recording) {
    const rec = spec.recording;
    for (const anchor of rec.sync.anchors) {
      if (!sessionLoaded.some(({ event }) => event.id === anchor.event_id)) fail(id, `sync anchor ${anchor.event_id} is not an event of the take`);
    }
    const source = resolve(rec.source);
    if (!existsSync(source)) blockers.push('source missing');
    else {
      sourceBytes = statSync(source).size;
      if ((await sha256File(source)) !== rec.source_sha256) fail(id, 'the source file does not match source_sha256');
    }
    const file = resolve(rec.playback);
    if (!existsSync(file)) blockers.push('playback missing');
    else {
      const bytes = statSync(file).size;
      const facts = await probe(file);
      if (!facts.video_codec || !VIDEO_CODECS.has(facts.video_codec)) fail(id, `playback video codec ${facts.video_codec ?? 'none'} is not H.264, VP8, or VP9`);
      if (facts.audio_streams !== 0) fail(id, `playback has ${facts.audio_streams} audio stream(s); it must have none`);
      if (bytes <= 0 || bytes > MAX_BYTES) fail(id, `playback is ${bytes} bytes; the limit is ${MAX_BYTES}`);
      if (!Number.isInteger(facts.duration_ms) || facts.duration_ms <= 0) fail(id, 'playback has no duration');
      const sha256 = await sha256File(file);
      playback = { file, bytes, sha256, probe: facts, object_path: objectPath(id, sha256) };
    }
    if (rec.redaction.spans === null || rec.redaction.verified.matches === null) blockers.push('redaction not recorded');
    else if (rec.redaction.verified.matches !== 0) blockers.push(`redaction check found ${rec.redaction.verified.matches} match(es)`);
  }

  // Step 3: media fields, then edges. Only the session files sit inside the recording window; rerun events keep null media.
  const meta: RecordingMeta | null = spec.recording && playback && seek.enabled && spec.recording.sync.wall_start_ms !== null
    ? {
      recording_id: spec.recording.id, recording_ref: playback.object_path, mode: spec.recording.mode,
      display_surface: spec.recording.mode === 'window' ? 'window' : 'monitor', consent: true, audio_tracks: 0, video_tracks: 1,
      wall_start_ms: spec.recording.sync.wall_start_ms, wall_end_ms: spec.recording.sync.wall_start_ms + playback.probe.duration_ms,
      pauses: [], bytes: playback.bytes,
    }
    : null;
  sessionLoaded = withMedia(sessionLoaded, meta);
  rerunLoaded = clearMedia(rerunLoaded);

  let events: Event[];
  let edges: Edge[];
  if (spec.edges === null) {
    const plan = planSession([...sessionLoaded, ...rerunLoaded]);
    events = plan.events;
    edges = plan.edges;
  } else {
    // T3: keep the captured events and their seq.
    events = mergeRerun(id, dedupeEvents(sessionLoaded.map((item) => item.event)), rerunLoaded.map((item) => item.event));
    const seqs = new Set<string>();
    for (const event of events) {
      const key = `${event.session_id}\u0000${event.seq}`;
      if (!Number.isInteger(event.seq) || seqs.has(key)) fail(id, `event ${event.id} has a missing or repeated seq`);
      seqs.add(key);
    }
    edges = await readEdges(id, resolve(spec.edges));
  }
  checkEdges(id, events, edges);

  const offsets = events.filter((event) => event.media_offset_ms != null).length;
  const firstTs = events.map((event) => event.ts).sort()[0] ?? null;
  const take: TakeRow = {
    id, label: spec.label, adapter: spec.adapter, capture_status: spec.capture_status, authorship: spec.authorship,
    authorship_note: spec.authorship_note, scenario: spec.scenario, session_ids: spec.session_ids,
    analysis_status: events.length === 0 ? 'missing' : spec.coverage.unknowns.length > 0 ? 'partial' : 'complete',
    analysis_version: spec.edges === null ? ANALYSIS_VERSION.linker : ANALYSIS_VERSION.edgesFile,
    verification: spec.verification, coverage: spec.coverage, recorded_at: firstTs, content_reviewed_at: spec.content_reviewed_at,
  };
  const recording: RecordingRow | null = spec.recording && playback
    ? {
      id: spec.recording.id, bucket: BUCKET, object_path: playback.object_path, content_type: 'video/mp4', bytes: playback.bytes,
      sha256: playback.sha256, source_sha256: spec.recording.source_sha256, source_bytes: sourceBytes,
      duration_ms: playback.probe.duration_ms, width: playback.probe.width, height: playback.probe.height,
      mode: spec.recording.mode, consent: true, audio_tracks: 0, sync: spec.recording.sync, redaction: spec.recording.redaction,
    }
    : null;

  // Step 4: scrub every string, then refuse on any secret.
  const plan: TakePlan = scrubValue({
    id, take, events: events.map(eventRow), edges: edges.map(edgeRow), recording, playback: null, sync_basis: spec.recording?.sync.basis ?? null, seek, offsets, blockers,
  }, home);
  plan.playback = playback;
  assertNoSecrets(id, { take: plan.take, recording: plan.recording, events: plan.events, edges: plan.edges }, options.secrets ?? secretValuesFromEnv(process.env));
  return plan;
}

// A T3 capture may already hold its rerun event, with a different advisory seq. That copy is kept; any other
// difference is an error (dedupeEvents). A rerun event the capture lacks gets the next seq of its session.
export function mergeRerun(take: string, captured: readonly Event[], rerun: readonly Event[]): Event[] {
  const out = [...captured];
  const byId = new Map(captured.map((event) => [event.id, event]));
  for (const event of rerun) {
    const prior = byId.get(event.id);
    if (prior) {
      try { dedupeEvents([prior, { ...event, seq: prior.seq }]); } catch (error) { fail(take, error instanceof Error ? error.message : 'rerun conflict'); }
      continue;
    }
    const seq = Math.max(0, ...out.filter((e) => e.session_id === event.session_id).map((e) => e.seq)) + 1;
    const added = { ...event, seq };
    out.push(added);
    byId.set(added.id, added);
  }
  return out;
}

export function checkEdges(take: string, events: readonly Pick<Event, 'id'>[], edges: readonly Pick<Edge, 'id' | 'src' | 'dst'>[]): void {
  const ids = new Set(events.map((event) => event.id));
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.src) || !ids.has(edge.dst)) fail(take, `edge ${edge.id} names an event that is not in the take`);
    if (edgeIds.has(edge.id)) fail(take, `edge ${edge.id} is listed twice`);
    edgeIds.add(edge.id);
  }
}

export function describePlan(plan: TakePlan): string[] {
  const lines = [`take ${plan.id} (${plan.take.adapter}, ${plan.take.capture_status})`];
  lines.push(`  events: ${plan.events.length}`);
  lines.push(`  edges: ${plan.edges.length} (${plan.take.analysis_version})`);
  if (!plan.sync_basis) {
    lines.push(`  offsets: ${plan.offsets}/${plan.events.length} events`);
    lines.push('  sync: n/a; playback: none (no recording)');
  } else {
    lines.push(`  offsets: ${plan.playback ? `${plan.offsets}/${plan.events.length} events` : 'n/a (playback missing)'}`);
    lines.push(`  sync: ${plan.sync_basis}; seek ${plan.seek.enabled ? 'on' : 'off'} (${plan.seek.reason})`);
    if (plan.playback) {
      lines.push(`  playback: ${plan.playback.bytes} bytes, sha256 ${plan.playback.sha256.slice(0, 12)}, ${plan.playback.probe.video_codec}, ${(plan.playback.probe.duration_ms / 1000).toFixed(3)} s`);
      lines.push(`  object: ${BUCKET}/${plan.playback.object_path}`);
    } else lines.push('  playback: missing');
  }
  lines.push(`  analysis: ${plan.take.analysis_status}; verification: ${plan.take.verification}`);
  lines.push(`  ready for upload: ${plan.blockers.length ? `no (${plan.blockers.join('; ')})` : 'yes'}`);
  return lines;
}

// ---- Live steps (section 2 and section 5, steps 7 and 8) ----
export async function uploadPlayback(store: RecordingStore, playback: Playback): Promise<'uploaded' | 'skipped'> {
  const body = await readFile(playback.file);
  if (body.length !== playback.bytes) throw new IngestError('The playback file changed after it was planned.');
  const result = await store.upload(playback.object_path, body, 'video/mp4');
  if (result === 'created') return 'uploaded';
  const existing = await store.size(playback.object_path);
  if (existing === playback.bytes) return 'skipped';
  throw new IngestError(`An object already exists at ${playback.object_path} with a different size (${existing ?? 'unknown'} bytes, local ${playback.bytes}). Nothing was overwritten.`);
}

export type Check = { name: string; pass: boolean };

export async function ingestTake(plan: TakePlan, deps: LiveDeps, options: { publish: boolean; log?: (line: string) => void }): Promise<Check[]> {
  const log = options.log ?? console.log;
  if (options.publish && !plan.take.content_reviewed_at) throw new IngestError(`${plan.id}: --publish refused: content_reviewed_at is not set. Watch the playback file, then set it in the manifest.`);
  if (plan.blockers.length) throw new IngestError(`${plan.id}: not ready: ${plan.blockers.join('; ')}. Nothing was sent.`);
  if (plan.recording && plan.playback) log(`upload: ${await uploadPlayback(deps.store, plan.playback)}`);
  const returned = await deps.db.replaceTake({ p_take: plan.take, p_recording: plan.recording, p_events: plan.events, p_edges: plan.edges });
  const want: Counts = { events: plan.events.length, edges: plan.edges.length, recordings: plan.recording ? 1 : 0 };
  const stored = await deps.db.counts(plan.id, plan.take.session_ids, plan.edges.map((edge) => edge.id));
  const checks: Check[] = [
    { name: 'replace_take counts equal the plan', pass: returned.events === want.events && returned.edges === want.edges && returned.recordings === want.recordings },
    { name: 'stored row counts equal the plan', pass: stored.events === want.events && stored.edges === want.edges && stored.recordings === want.recordings },
  ];
  if (plan.recording && plan.playback) {
    checks.push({ name: 'storage lists the object with the same size', pass: (await deps.store.size(plan.playback.object_path)) === plan.playback.bytes });
    const url = await deps.store.signedUrl(plan.playback.object_path, SIGNED_URL_SECONDS);
    let status = 0;
    if (url) { try { status = await deps.range(url); } catch { status = 0; } }
    checks.push({ name: 'signed URL answers Range: bytes=0-1 with 206', pass: status === 206 });
  }
  for (const check of checks) log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
  if (!checks.every((check) => check.pass)) throw new IngestError(`${plan.id}: a check failed; the take stays hidden.`);
  if (options.publish) {
    await deps.db.setVisible(plan.id);
    log('published: visible = true');
  }
  return checks;
}

// ---- Live adapters (not used by tests) ----
const CHUNK = 20;

function liveDeps(url: string, secret: string): LiveDeps {
  const client = createClient(url, secret, { auth: { persistSession: false } });
  const bucket = client.storage.from(BUCKET);
  const countIn = async (table: 'events' | 'edges', column: string, values: readonly string[]): Promise<number> => {
    let total = 0;
    for (let i = 0; i < values.length; i += CHUNK) {
      const { count, error } = await client.from(table).select('id', { count: 'exact', head: true }).in(column, values.slice(i, i + CHUNK));
      if (error || count == null) throw new IngestError(`Counting ${table} failed.`);
      total += count;
    }
    return total;
  };
  return {
    store: {
      async upload(object, body, contentType) {
        const { error } = await bucket.upload(object, body, { contentType, upsert: false });
        if (!error) return 'created';
        const status = String((error as { statusCode?: string | number }).statusCode ?? '');
        if (status === '409' || /exists|duplicate/i.test(error.message)) return 'exists';
        throw new IngestError(`Upload of ${object} failed: ${error.message}`);
      },
      async size(object) {
        const { data, error } = await bucket.list(path.posix.dirname(object), { search: path.posix.basename(object), limit: 100 });
        if (error) throw new IngestError(`The ${BUCKET} bucket could not be listed.`);
        const item = (data ?? []).find((entry) => entry.name === path.posix.basename(object));
        const size = (item?.metadata as { size?: unknown } | undefined)?.size;
        return typeof size === 'number' ? size : null;
      },
      async signedUrl(object, seconds) {
        const { data, error } = await bucket.createSignedUrl(object, seconds);
        return error || !data ? null : data.signedUrl;
      },
    },
    db: {
      async replaceTake(args) {
        const { data, error } = await client.rpc('replace_take', args);
        if (error) {
          if (isMissingFunction(error)) throw new IngestError('replace_take function not found; apply migration 20261030000000. Nothing was changed.');
          throw new IngestError(`replace_take failed; the take was left unchanged (atomic replace): ${error.message}`);
        }
        const counts = data as Partial<Counts> | null;
        return { events: counts?.events ?? -1, edges: counts?.edges ?? -1, recordings: counts?.recordings ?? -1 };
      },
      async counts(takeId, sessionIds, edgeIds) {
        const { count: recordings, error } = await client.from('recordings').select('id', { count: 'exact', head: true }).eq('take_id', takeId);
        if (error || recordings == null) throw new IngestError('Counting recordings failed.');
        return { events: await countIn('events', 'session_id', sessionIds), edges: await countIn('edges', 'id', edgeIds), recordings };
      },
      async setVisible(takeId) {
        const { data, error } = await client.from('takes').update({ visible: true }).eq('id', takeId).not('content_reviewed_at', 'is', null).select('id');
        if (error || !data || data.length !== 1) throw new IngestError('Setting visible = true failed.');
      },
    },
    async range(signed) {
      const response = await fetch(signed, { headers: { Range: 'bytes=0-1' }, signal: AbortSignal.timeout(15000) });
      await response.body?.cancel();
      return response.status;
    },
  };
}

function loadServerEnv(): { url: string; secret: string } {
  try { process.loadEnvFile?.(path.join(repoRoot, '.env')); } catch { /* A missing file is reported below. */ }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new IngestError('Ingest requires server configuration; no data was sent.');
  assertTracerProject(url);
  return { url, secret };
}

// ---- CLI ----
export type IngestArgs = { dryRun: boolean; all: boolean; take?: string; publish: boolean };

function usage(): never {
  throw new IngestError('Usage: npm run ingest -- --dry-run [--take <id> | --all] | --take <id> [--publish]');
}

export function parseIngestArgs(argv: readonly string[]): IngestArgs {
  const args: IngestArgs = { dryRun: false, all: false, publish: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--take') {
      args.take = argv[++i];
      if (!args.take || args.take.startsWith('--')) usage();
    } else usage();
  }
  if (args.all === Boolean(args.take)) usage();
  if (args.all && !args.dryRun) usage();
  if (args.dryRun && args.publish) usage();
  return args;
}

export async function runIngest(args: IngestArgs, options: PlanOptions & { manifest?: string; deps?: LiveDeps; log?: (line: string) => void; loadEnv?: () => { url: string; secret: string } } = {}): Promise<{ plans: TakePlan[]; failed: string[] }> {
  const log = options.log ?? console.log;
  const specs = await readManifest(options.manifest);
  const selected = args.all ? specs : specs.filter((spec) => spec.id === args.take);
  if (selected.length === 0) throw new IngestError(`The manifest has no take ${args.take}`);
  if (args.publish && !selected[0].content_reviewed_at) throw new IngestError(`${selected[0].id}: --publish refused: content_reviewed_at is not set. Watch the playback file, then set it in the manifest.`);
  // A live run loads the repo .env before planning, so the secret check sees every server value,
  // including one that exists only in .env (review A, finding 1). It also asserts the project host before any client opens.
  const env = args.dryRun ? null : (options.loadEnv ?? loadServerEnv)();
  const plans: TakePlan[] = [];
  const failed: string[] = [];
  for (const spec of selected) {
    try {
      const plan = await planTake(spec, options);
      plans.push(plan);
      for (const line of describePlan(plan)) log(line);
    } catch (error) {
      if (!args.dryRun) throw error;
      failed.push(spec.id);
      log(`take ${spec.id}\n  ERROR: ${error instanceof Error ? error.message : 'planning failed'}`);
    }
  }
  if (args.dryRun) return { plans, failed };
  const deps = options.deps ?? liveDeps(env!.url, env!.secret);
  await ingestTake(plans[0], deps, { publish: args.publish, log });
  return { plans, failed };
}

async function main(): Promise<void> {
  const result = await runIngest(parseIngestArgs(process.argv.slice(2)));
  if (result.failed.length) process.exitCode = 1;
}

const calledDirectly = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (calledDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'ingest failed';
    console.error(message.includes('eyJ') || message.includes('sb_secret') ? 'ingest failed' : message);
    process.exitCode = 1;
  });
}
