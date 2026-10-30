import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Event, RecordingMeta } from '../../../packages/core/event.ts';
import { attachMedia } from '../../../packages/core/src/sync.ts';
import { linkEvents } from '../../../packages/link/src/rules.ts';

const ACTORS = new Set<Event['actor']>(['developer', 'agent', 'tool', 'ci', 'unknown']);
const TYPES = new Set<Event['type']>([
  'prompt', 'tool_call', 'file_edit', 'test', 'question', 'answer', 'recording_start', 'pause', 'resume', 'stop',
]);
const SOURCES = new Set<Event['source']>(['claude_code_hook', 'git', 'sandbox', 'devlens_question', 'media_recorder']);
const PROVENANCE = new Set<Event['provenance']>(['observed', 'inferred']);
const REQUIRED = [
  'id', 'session_id', 'project_id', 'ts', 'seq', 'actor', 'type', 'source', 'provenance', 'recording_ref', 'media_offset_ms', 'payload',
] as const;

const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'sk-', re: /(?<![A-Za-z0-9])sk-(?:ant-)?[A-Za-z0-9_-]{8,}/ },
  { name: 'Bearer', re: /Bearer\s+[A-Za-z0-9\-._~+/=]+/i },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
];

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MP4_TOP_BOXES = ['ftyp', 'moov', 'mdat'];

// The golden playback is the blurred H.264 MP4 (see plans/take-ingest-contract.md). Structure only: no decode.
export function mp4Problem(bytes: Buffer): string | null {
  if (bytes.length === 0) return 'playback.mp4 is empty';
  if (bytes.length >= MAX_VIDEO_BYTES) return 'playback.mp4 is 50 MB or larger';
  if (bytes.subarray(4, 8).toString('latin1') !== 'ftyp') return 'playback.mp4 is not an MP4 file';
  const seen = new Set<string>();
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return 'playback.mp4 has a truncated box';
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (size < header || offset + size > bytes.length) return 'playback.mp4 has a box that runs past the end of the file';
    seen.add(type);
    offset += size;
  }
  if (offset !== bytes.length) return 'playback.mp4 has trailing bytes';
  if (!MP4_TOP_BOXES.every((box) => seen.has(box))) return 'playback.mp4 is missing ftyp, moov, or mdat';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEvent(value: unknown): value is Event {
  if (!isRecord(value)) return false;
  for (const key of REQUIRED) {
    if (!(key in value)) return false;
  }
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.session_id !== 'string' || value.session_id.length === 0) return false;
  if (typeof value.project_id !== 'string' || value.project_id.length === 0) return false;
  if (typeof value.ts !== 'string' || value.ts.length === 0) return false;
  if (typeof value.seq !== 'number' || !Number.isFinite(value.seq)) return false;
  if (typeof value.actor !== 'string' || !ACTORS.has(value.actor as Event['actor'])) return false;
  if (typeof value.type !== 'string' || !TYPES.has(value.type as Event['type'])) return false;
  if (typeof value.source !== 'string' || !SOURCES.has(value.source as Event['source'])) return false;
  if (typeof value.provenance !== 'string' || !PROVENANCE.has(value.provenance as Event['provenance'])) return false;
  if (value.recording_ref !== null && typeof value.recording_ref !== 'string') return false;
  if (value.media_offset_ms !== null && (typeof value.media_offset_ms !== 'number' || !Number.isFinite(value.media_offset_ms))) return false;
  if (value.tool_use_id !== undefined && value.tool_use_id !== null && typeof value.tool_use_id !== 'string') return false;
  if (!isRecord(value.payload)) return false;
  return true;
}

function commandOf(event: Event): string | null {
  const command = event.payload.command;
  return typeof command === 'string' && command.length > 0 ? command : null;
}

function statusOf(event: Event): 'passed' | 'failed' | 'unknown' | null {
  const status = event.payload.status;
  if (status === 'passed' || status === 'failed' || status === 'unknown') return status;
  return null;
}

function howToRecord(): void {
  console.error('golden fixture not recorded yet');
  console.error('How to record: follow examples/broken-api/RECORDING.md.');
  console.error('From the repo root, run: node examples/broken-api/scripts/take-setup.mjs');
  console.error('Open /record, record the code window, then copy .devlens/events.jsonl to examples/broken-api/fixtures/golden/session.jsonl and the blurred, reviewed MP4 to examples/broken-api/fixtures/golden/playback.mp4.');
  console.error('Run: npm run fixture:verify -- broken-api');
}

function main(): void {
  if (process.argv[2] !== 'broken-api') {
    console.error('usage: npm run fixture:verify -- broken-api');
    process.exit(1);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const goldenDir = path.join(here, '..', 'fixtures', 'golden');
  const jsonlPath = path.join(goldenDir, 'session.jsonl');
  const videoPath = path.join(goldenDir, 'playback.mp4');
  if (!existsSync(jsonlPath) || !existsSync(videoPath)) {
    howToRecord();
    process.exit(1);
  }

  const problems: string[] = [];
  const raw = readFileSync(jsonlPath, 'utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(raw)) problems.push(`JSONL contains a secret-shaped ${pattern.name} value`);
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) problems.push('session.jsonl has no events');
  const events: Event[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`line ${lineNo} is not valid JSON`);
      return;
    }
    if (!isEvent(parsed)) {
      problems.push(`line ${lineNo} is missing required Event fields`);
      return;
    }
    if (parsed.provenance !== 'observed' || parsed.source !== 'claude_code_hook') {
      problems.push(`line ${lineNo} is not labelled as a real recording (provenance observed, source claude_code_hook)`);
    }
    events.push(parsed);
  });

  const ordered = [...events].sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  const failedAt = new Map<string, number>();
  let sawLaterPass = false;
  ordered.forEach((event, index) => {
    if (event.type !== 'test') return;
    const command = commandOf(event);
    const status = statusOf(event);
    if (!command || !status || status === 'unknown') return;
    if (status === 'failed') {
      if (!failedAt.has(command)) failedAt.set(command, index);
      return;
    }
    const start = failedAt.get(command);
    if (start !== undefined && start < index) sawLaterPass = true;
  });
  if (!sawLaterPass) problems.push('JSONL has no failed test followed by a later passed test with the same command');

  if (events.length > 0) {
    try {
      const ids = new Set(events.map((event) => event.id));
      const verifies = linkEvents(events).filter((edge) => edge.rel === 'verifies');
      if (verifies.length === 0) problems.push('linkEvents produced no verifies edge');
      for (const edge of verifies) {
        const cited = [...edge.evidence_event_ids, edge.src, edge.dst];
        if (edge.evidence_event_ids.length === 0) problems.push('verifies edge has no evidence_event_ids');
        if (cited.some((id) => !ids.has(id))) problems.push('verifies edge cites an event id that is not in the JSONL');
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'linkEvents failed');
    }
  }

  const metaPath = path.join(goldenDir, 'meta.json');
  if (!existsSync(metaPath)) problems.push('meta.json is missing; copy the recording meta.json from private storage next to playback.mp4');
  else {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as RecordingMeta;
      const windowMs = meta.wall_end_ms == null ? null : meta.wall_end_ms - meta.wall_start_ms;
      const linked = attachMedia(events, meta);
      const outside = linked.filter((event) => event.media_offset_ms == null || event.recording_ref !== meta.recording_ref);
      if (outside.length > 0) problems.push(`${outside.length} event(s) fall outside the recording window in meta.json`);
      if (windowMs == null || windowMs <= 0) problems.push('meta.json has no usable recording window');
      if (meta.audio_tracks !== 0 || meta.video_tracks !== 1 || meta.consent !== true) problems.push('meta.json does not show consent, one video track, and no audio');
      if (meta.bytes == null || meta.bytes !== statSync(videoPath).size) problems.push('playback.mp4 size does not match meta.json bytes');
      if (meta.mode !== 'window' || meta.display_surface !== 'window') problems.push('meta.json is not a window-mode take of one window');
      const sha12 = createHash('sha256').update(readFileSync(videoPath)).digest('hex').slice(0, 12);
      if (typeof meta.recording_id !== 'string' || meta.recording_ref !== `takes/golden-broken-api/${sha12}.mp4`) problems.push(`meta.json recording_ref does not match the playback file (expected takes/golden-broken-api/${sha12}.mp4)`);
    } catch {
      problems.push('meta.json is not valid JSON');
    }
  }

  const problem = mp4Problem(readFileSync(videoPath));
  if (problem) problems.push(problem);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    process.exit(1);
  }
  console.log('PASS');
}

const entry = process.argv[1];
if (typeof entry === 'string' && entry.replaceAll('\\', '/').endsWith('/examples/broken-api/scripts/fixture-verify.ts')) {
  main();
}
