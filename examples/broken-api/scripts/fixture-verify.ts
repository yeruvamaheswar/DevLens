import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Event } from '../../../packages/core/event.ts';
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

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const MAX_WEBM_BYTES = 50 * 1024 * 1024;

type Vint = { value: number; next: number; unknown: boolean };

function readVint(bytes: Buffer, offset: number, keepMarker: boolean): Vint | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset] ?? 0;
  if (first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let unknown = false;
  if (!keepMarker) {
    unknown = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < length; i += 1) {
      if (bytes[offset + i] !== 0xff) unknown = false;
    }
  }
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < length; i += 1) value = value * 256 + (bytes[offset + i] ?? 0);
  if (!Number.isSafeInteger(value)) return null;
  return { value, next: offset + length, unknown };
}

export function webmProblem(bytes: Buffer): string | null {
  if (bytes.length === 0) return 'WebM is empty';
  if (bytes.length >= MAX_WEBM_BYTES) return 'WebM is 50 MB or larger';
  let offset = 0;
  let sawEbml = false;
  let sawWebm = false;
  let sawSegment = false;
  while (offset + 2 <= bytes.length) {
    const id = readVint(bytes, offset, true);
    if (!id) return 'WebM is not a decodable file';
    const size = readVint(bytes, id.next, false);
    if (!size) return 'WebM is not a decodable file';
    if (offset === 0 && id.value !== EBML_ID) return 'WebM is not a decodable file';
    if (id.value === EBML_ID) {
      sawEbml = true;
      if (!size.unknown && size.value >= 0 && size.next + size.value <= bytes.length) {
        if (bytes.subarray(size.next, size.next + size.value).includes(Buffer.from('webm'))) sawWebm = true;
      }
    }
    if (id.value === SEGMENT_ID) sawSegment = true;
    if (size.unknown || id.value === SEGMENT_ID) break;
    const next = size.next + size.value;
    if (next <= offset || next > bytes.length) return 'WebM is not a decodable file';
    offset = next;
  }
  if (!sawEbml || !sawWebm || !sawSegment) return 'WebM is not a decodable file';
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
  console.error('Open /record, record the code window, then copy .devlens/events.jsonl to examples/broken-api/fixtures/golden/session.jsonl and the reviewed WebM to examples/broken-api/fixtures/golden/session.webm.');
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
  const webmPath = path.join(goldenDir, 'session.webm');
  if (!existsSync(jsonlPath) || !existsSync(webmPath)) {
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

  const webmBytes = statSync(webmPath).size;
  if (webmBytes >= MAX_WEBM_BYTES) problems.push('WebM is 50 MB or larger');
  else {
    const problem = webmProblem(readFileSync(webmPath));
    if (problem) problems.push(problem);
  }

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
