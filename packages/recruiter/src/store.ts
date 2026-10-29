import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acquire } from '../../agent/src/ledger';
import { redactString, secretValuesFromEnv, shortSecretValuesFromEnv } from '../../capture/redact';
import type { Event } from '../../core/event';
import { buildEntry, type EntryKind, type RecruiterEntry } from './build';

export const DEFAULT_GAP_MIN = 10;

export const recruiterPath = (dir: string) => path.join(dir, '.devlens', 'recruiter.jsonl');
export const sharePath = (dir: string) => path.join(dir, '.devlens', 'share.json');
const eventsPath = (dir: string) => path.join(dir, '.devlens', 'events.jsonl');

// Off unless share.json parses and enabled is exactly true.
export function isSharing(dir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(sharePath(dir), 'utf8')) as { enabled?: unknown } | null;
    return parsed !== null && typeof parsed === 'object' && parsed.enabled === true;
  } catch {
    return false;
  }
}

export function setSharing(dir: string, enabled: boolean): void {
  mkdirSync(path.dirname(sharePath(dir)), { recursive: true });
  writeFileSync(sharePath(dir), `${JSON.stringify({ enabled })}\n`, 'utf8');
}

// DEVLENS_UPDATE_EVERY_MIN: whole or decimal minutes, 0 means every eligible Stop. Anything else uses the default.
export function gapMinutes(env: Record<string, string | undefined>): number {
  const raw = env.DEVLENS_UPDATE_EVERY_MIN;
  if (typeof raw !== 'string' || raw.trim().length === 0) return DEFAULT_GAP_MIN;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_GAP_MIN;
}

function isEntry(value: unknown): value is RecruiterEntry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<RecruiterEntry>;
  return typeof entry.id === 'string' && (entry.kind === 'update' || entry.kind === 'status') && typeof entry.ts === 'string' && Array.isArray(entry.lines);
}

// Oldest first. A missing file is no entries; a damaged line is skipped.
export function readEntries(dir: string): RecruiterEntry[] {
  let text: string;
  try { text = readFileSync(recruiterPath(dir), 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: RecruiterEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isEntry(value)) out.push(value);
    } catch { /* skip a torn line */ }
  }
  return out;
}

export function readAllEvents(dir: string): Event[] {
  let text: string;
  try { text = readFileSync(eventsPath(dir), 'utf8'); } catch { return []; }
  const out: Event[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const value = JSON.parse(line) as Event;
      if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.session_id === 'string' && typeof value.ts === 'string') out.push(value);
    } catch { /* skip a torn line */ }
  }
  return out;
}

function redactorFor(env: Record<string, string | undefined>): (text: string) => string {
  const secrets = secretValuesFromEnv(env);
  const shorts = shortSecretValuesFromEnv(env);
  return (text) => redactString(text, secrets, shorts);
}

type Options = { env?: Record<string, string | undefined>; now?: Date };
export type SendResult = { sent: RecruiterEntry | null; skipped: string | null };

// Build and append under one lock, so two Stops (or a Stop and a status request) cannot both append the same window.
function appendLocked(dir: string, decide: (entries: RecruiterEntry[]) => { entry: RecruiterEntry | null; skipped: string | null }): SendResult {
  const release = acquire(`${recruiterPath(dir)}.lock`);
  if (!release) return { sent: null, skipped: 'recruiter_locked' };
  try {
    const { entry, skipped } = decide(readEntries(dir));
    if (!entry) return { sent: null, skipped };
    appendFileSync(recruiterPath(dir), `${JSON.stringify(entry)}\n`, 'utf8');
    return { sent: entry, skipped: null };
  } finally { release(); }
}

const entryId = (kind: EntryKind, count: number, now: Date) => `${kind}-${count + 1}-${now.getTime()}`;

// Stop trigger (REQ-36). Sends only with sharing on, the gap passed since the last update,
// and at least one new developer prompt in this session since the last entry of any kind.
export function maybeSendUpdate(dir: string, session_id: string, options: Options = {}): SendResult {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  if (!isSharing(dir)) return { sent: null, skipped: 'sharing_off' };
  const gapMs = gapMinutes(env) * 60_000;
  return appendLocked(dir, (entries) => {
    const lastUpdate = entries.findLast((entry) => entry.kind === 'update');
    if (lastUpdate && now.getTime() - Date.parse(lastUpdate.ts) < gapMs) return { entry: null, skipped: 'inside_gap' };
    const since = entries.length > 0 ? entries[entries.length - 1].ts : null;
    const events = readAllEvents(dir).filter((event) => event.session_id === session_id);
    const entry = buildEntry(events, since, 'update', { now, id: entryId('update', entries.length, now), redact: redactorFor(env) });
    return entry ? { entry, skipped: null } : { entry: null, skipped: 'no_new_prompt' };
  });
}

// On-demand status (REQ-37): the whole latest session, built now.
export function requestStatus(dir: string, options: Options = {}): SendResult {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  if (!isSharing(dir)) return { sent: null, skipped: 'sharing_off' };
  return appendLocked(dir, (entries) => {
    const all = readAllEvents(dir);
    const session = all.length > 0 ? all[all.length - 1].session_id : null;
    const events = session === null ? [] : all.filter((event) => event.session_id === session);
    return { entry: buildEntry(events, null, 'status', { now, id: entryId('status', entries.length, now), redact: redactorFor(env) }), skipped: null };
  });
}
