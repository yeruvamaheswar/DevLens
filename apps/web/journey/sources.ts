// Server only. Loads normalized events for the journey from one source. Golden, local, and saved captures are files,
// so the demo works offline. Published captures (`t3-pub:`) come from private storage with the server key, when it is set.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Edge, Event } from '../../../packages/core/event';
import { loadGoldenExtras } from '../../../packages/core/fixture';
import { goldenFile, goldenLabel, localGoldenReplay } from '../../../packages/core/server';
import { isPublishedName, webCaptureBucket, type CaptureBucket } from '../../../packages/t3/src/publish';
import { buildReplayView, redactPaths } from '../replay/view';
import { buildJourney, type Journey, type JourneySourceMeta } from './build';

export type JourneySourceRow = { key: string; label: string; status: JourneySourceMeta['status']; adapter: JourneySourceMeta['adapter'] };
export type JourneyResponse = { journey: Journey; events: Event[]; edges: Edge[] };

const THREAD_ID = /^[A-Za-z0-9._:%-]{6,300}$/;

export function repoRoot(): string {
  return process.cwd().endsWith(`${path.sep}apps${path.sep}web`) ? path.resolve(process.cwd(), '../..') : process.cwd();
}

export function t3Root(): string {
  return path.join(repoRoot(), '.devlens', 't3');
}

// Captures saved with `npm run t3 -- save` are committed, so a hosted build can show them.
export function savedRoot(): string {
  return path.join(repoRoot(), 'examples', 't3-captures');
}

// A thread id names one folder under .devlens/t3 (or, when saved, under examples/t3-captures). Anything else is refused.
export function t3Dir(threadId: string, root: string = t3Root()): string | null {
  if (!THREAD_ID.test(threadId) || threadId.includes('..')) return null;
  const dir = path.join(root, threadId);
  return path.dirname(dir) === root && existsSync(path.join(dir, 'capture.json')) ? dir : null;
}

// `t3:<thread>` is a local import; `t3-saved:<name>` is a committed capture.
export function captureDir(key: string): string | null {
  if (key.startsWith('t3:')) return t3Dir(key.slice(3));
  if (key.startsWith('t3-saved:')) return t3Dir(key.slice(9), savedRoot());
  return null;
}

// `t3-pub:<name>` is a published capture in the private t3-captures bucket. The name is one folder; anything else is refused.
export function publishedName(key: string): string | null {
  if (!key.startsWith('t3-pub:')) return null;
  const name = key.slice(7);
  return isPublishedName(name) ? name : null;
}

function parseJsonl<T>(text: string): T[] {
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

function readJsonl<T>(file: string): T[] {
  return existsSync(file) ? parseJsonl<T>(readFileSync(file, 'utf8')) : [];
}

// Every string in a payload, at any depth, loses home and temp paths.
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactPaths(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
  return value;
}

// Display copy: no raw hook payloads, no home paths anywhere in the payload.
function strip(event: Event): Event {
  const payload: Record<string, unknown> = { ...event.payload };
  delete payload.raw;
  return { ...event, payload: redactDeep(payload) as Record<string, unknown> };
}

function capturesIn(root: string, prefix: string, suffix: string) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && t3Dir(entry.name, root))
    .flatMap((entry) => {
      // One unreadable capture must not hide the others or the golden take.
      try {
        const capture = JSON.parse(readFileSync(path.join(root, entry.name, 'capture.json'), 'utf8')) as { label: string; imported_at: string };
        return [{ key: `${prefix}${entry.name}`, label: `${String(capture.label)}${suffix}`, status: 'experimental' as const, adapter: 't3_code' as const, at: String(capture.imported_at) }];
      } catch {
        return [];
      }
    });
}

// No bucket (variables missing) or an unreadable bucket means no published rows. The other sources still list.
async function publishedCaptures(bucket: CaptureBucket | null) {
  if (!bucket) return [];
  let names: string[];
  try {
    names = await bucket.list('');
  } catch {
    return [];
  }
  const rows = await Promise.all(names.filter(isPublishedName).map(async (name) => {
    try {
      const raw = await bucket.download(`${name}/capture.json`);
      if (!raw) return [];
      const capture = JSON.parse(raw.toString('utf8')) as { label: string; imported_at: string };
      return [{ key: `t3-pub:${name}`, label: `${String(capture.label)} (published)`, status: 'experimental' as const, adapter: 't3_code' as const, at: String(capture.imported_at) }];
    } catch {
      return [];
    }
  }));
  return rows.flat();
}

export async function listSources(bucket: CaptureBucket | null = webCaptureBucket()): Promise<JourneySourceRow[]> {
  const rows: JourneySourceRow[] = [{ key: 'golden', label: `Claude Code: ${goldenLabel}`, status: 'verified', adapter: 'claude_code_hook' }];
  const captures = [...capturesIn(t3Root(), 't3:', ''), ...capturesIn(savedRoot(), 't3-saved:', ' (saved)'), ...await publishedCaptures(bucket)].sort((a, b) => b.at.localeCompare(a.at));
  return [...rows, ...captures.map(({ at: _at, ...row }) => row)];
}

async function golden(): Promise<JourneyResponse> {
  const replay = await localGoldenReplay();
  const view = buildReplayView(replay, await readFile(goldenFile('git-diffs.patch'), 'utf8'), await loadGoldenExtras());
  const source: JourneySourceMeta = {
    key: 'golden',
    label: `Claude Code: ${goldenLabel}`,
    adapter: 'claude_code_hook',
    status: 'verified',
    provenance_note: 'Captured by Claude Code hooks during a consented, recorded take. Checked by fixture:verify.',
    unknowns: view.unknowns,
    not_captured: view.not_captured,
    media: { url: '/api/replay/media', label: 'Window recording of the Claude Code terminal. Audio and camera off.' },
  };
  const questions = view.questions.map((question) => ({ id: question.id, rule_id: question.rule_id, text: question.text, event_ids: question.event_ids, answer: question.answer }));
  return { journey: buildJourney({ events: replay.events, edges: replay.edges, source, questions }), events: replay.events.map(strip), edges: replay.edges };
}

// `t3 watch` stamps capture.json on every poll. A stamp under 15 s old means the session is being watched now.
const LIVE_WINDOW_MS = 15_000;
export function isLive(updatedAt: unknown, now: number = Date.now()): boolean {
  const at = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(at) && now - at >= 0 && now - at < LIVE_WINDOW_MS;
}

type CaptureFile = { label: string; unknowns: string[]; not_captured: string[]; t3: { title: string; workspace: string | null }; watch?: { updated_at?: string } };
const T3_NOTE = 'Read from the T3 Code server’s local store by the DevLens T3 adapter (experimental, read-only). T3 records what each provider reported; DevLens did not hook the provider.';

function t3(key: string): JourneyResponse | null {
  const dir = captureDir(key);
  if (!dir) return null;
  const capture = JSON.parse(readFileSync(path.join(dir, 'capture.json'), 'utf8')) as CaptureFile;
  const events = readJsonl<Event>(path.join(dir, 'events.jsonl'));
  const edges = readJsonl<Edge>(path.join(dir, 'edges.jsonl'));
  return t3Response(key, capture, events, edges, existsSync(path.join(dir, 'recording.webm')), T3_NOTE);
}

// A published copy of a capture, read from the private bucket. Works with no local disk (Vercel).
async function published(key: string, bucket: CaptureBucket | null): Promise<JourneyResponse | null> {
  const name = publishedName(key);
  if (!name || !bucket) return null;
  const raw = await bucket.download(`${name}/capture.json`);
  if (!raw) return null;
  const [eventsRaw, edgesRaw, files] = await Promise.all([bucket.download(`${name}/events.jsonl`), bucket.download(`${name}/edges.jsonl`), bucket.list(name)]);
  const capture = JSON.parse(raw.toString('utf8')) as CaptureFile;
  const events = eventsRaw ? parseJsonl<Event>(eventsRaw.toString('utf8')) : [];
  const edges = edgesRaw ? parseJsonl<Edge>(edgesRaw.toString('utf8')) : [];
  return t3Response(key, capture, events, edges, files.includes('recording.webm'), `${T3_NOTE} Published copy, read from private DevLens storage.`);
}

function t3Response(key: string, capture: CaptureFile, events: Event[], edges: Edge[], hasVideo: boolean, note: string): JourneyResponse {
  const source: JourneySourceMeta = {
    key,
    label: capture.label,
    adapter: 't3_code',
    status: 'experimental',
    provenance_note: note,
    unknowns: capture.unknowns,
    not_captured: capture.not_captured,
    live: isLive(capture.watch?.updated_at),
    media: hasVideo ? { url: `/api/journey/media?source=${encodeURIComponent(key)}`, label: 'Window recording of the T3 Code app. Audio and camera off.' } : null,
  };
  return { journey: buildJourney({ events, edges, source }), events: events.map(strip), edges };
}

// The bucket is only opened for a `t3-pub:` key, so the other sources never need the server key.
export async function loadJourney(key: string, bucket?: CaptureBucket | null): Promise<JourneyResponse | null> {
  if (key === 'golden') return golden();
  if (key.startsWith('t3:') || key.startsWith('t3-saved:')) return t3(key);
  if (key.startsWith('t3-pub:')) return published(key, bucket === undefined ? webCaptureBucket() : bucket);
  return null;
}
