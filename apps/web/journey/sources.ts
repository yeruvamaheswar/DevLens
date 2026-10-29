// Server only. Loads normalized events for the journey from one source. Local files only, so the demo works offline.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Edge, Event } from '../../../packages/core/event';
import { loadGoldenExtras } from '../../../packages/core/fixture';
import { goldenFile, goldenLabel, localGoldenReplay } from '../../../packages/core/server';
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

// A thread id names one folder under .devlens/t3. Anything else is refused.
export function t3Dir(threadId: string): string | null {
  if (!THREAD_ID.test(threadId) || threadId.includes('..')) return null;
  const dir = path.join(t3Root(), threadId);
  return path.dirname(dir) === t3Root() && existsSync(path.join(dir, 'capture.json')) ? dir : null;
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
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

export function listSources(): JourneySourceRow[] {
  const rows: JourneySourceRow[] = [{ key: 'golden', label: `Claude Code: ${goldenLabel}`, status: 'verified', adapter: 'claude_code_hook' }];
  if (!existsSync(t3Root())) return rows;
  const captures = readdirSync(t3Root(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && t3Dir(entry.name))
    .flatMap((entry) => {
      // One unreadable capture must not hide the others or the golden take.
      try {
        const capture = JSON.parse(readFileSync(path.join(t3Root(), entry.name, 'capture.json'), 'utf8')) as { label: string; imported_at: string };
        return [{ key: `t3:${entry.name}`, label: String(capture.label), status: 'experimental' as const, adapter: 't3_code' as const, at: String(capture.imported_at) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at));
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

function t3(threadId: string): JourneyResponse | null {
  const dir = t3Dir(threadId);
  if (!dir) return null;
  const capture = JSON.parse(readFileSync(path.join(dir, 'capture.json'), 'utf8')) as { label: string; unknowns: string[]; not_captured: string[]; t3: { title: string; workspace: string | null } };
  const events = readJsonl<Event>(path.join(dir, 'events.jsonl'));
  const edges = readJsonl<Edge>(path.join(dir, 'edges.jsonl'));
  const hasVideo = existsSync(path.join(dir, 'recording.webm'));
  const source: JourneySourceMeta = {
    key: `t3:${threadId}`,
    label: capture.label,
    adapter: 't3_code',
    status: 'experimental',
    provenance_note: 'Read from the T3 Code server’s local store by the DevLens T3 adapter (experimental, read-only). T3 records what each provider reported; DevLens did not hook the provider.',
    unknowns: capture.unknowns,
    not_captured: capture.not_captured,
    media: hasVideo ? { url: `/api/journey/media?thread=${encodeURIComponent(threadId)}`, label: 'Window recording of the T3 Code app. Audio and camera off.' } : null,
  };
  return { journey: buildJourney({ events, edges, source }), events: events.map(strip), edges };
}

export async function loadJourney(key: string): Promise<JourneyResponse | null> {
  if (key === 'golden') return golden();
  if (key.startsWith('t3:')) return t3(key.slice(3));
  return null;
}
