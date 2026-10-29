import { redactString } from '../../capture/redact';
import type { Event } from '../../core/event';
import { bannedReason, normalize } from '../../agent/src/validate';

// Pure rules: no I/O, no model. Every line is a fact from the session log and cites the events it rests on.
// NOT-12: no score, rank, ratio, or verdict; no code, diffs, file contents, or tool output text.

export type EntryKind = 'update' | 'status';
export type RecruiterLine = { text: string; cites: string[] };
export type RecruiterEntry = { id: string; kind: EntryKind; ts: string; since: string | null; lines: RecruiterLine[] };

export const QUOTE_CHARS = 120;
export const MAX_FILE_NAMES = 8;

const CONTROL = /[\p{Cc}]/gu;

function isoSeconds(ts: string): string {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const isPrompt = (event: Event) => event.actor === 'developer' && event.type === 'prompt';

// Collapse whitespace and control characters, redact, then cut. Redacting before the cut keeps a secret whole when it is matched.
export function quotePrompt(text: string, redact: (text: string) => string): string {
  const flat = redact(normalize(text).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim());
  const chars = [...flat];
  return chars.length > QUOTE_CHARS ? `${chars.slice(0, QUOTE_CHARS).join('')}…` : flat;
}

function baseName(file: string): string {
  const parts = file.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

type TestCounts = { failed: number | null; passed: number | null };

function lastNumber(text: string, pattern: RegExp): number | null {
  const all = [...text.matchAll(pattern)];
  return all.length > 0 ? Number(all[all.length - 1][1]) : null;
}

// Counts only, never the text. Prefer the "Tests" summary line (vitest, jest), then node:test, then pytest-style totals.
export function testCounts(output: string): TestCounts {
  const summary = output.split('\n').findLast((line) => /^\s*Tests:?\s/.test(line));
  const source = summary ?? output;
  const node = { failed: lastNumber(output, /ℹ fail (\d+)/g), passed: lastNumber(output, /ℹ pass (\d+)/g) };
  if (!summary && (node.failed !== null || node.passed !== null)) return node;
  return { failed: lastNumber(source, /(\d+)\s+failed\b/g), passed: lastNumber(source, /(\d+)\s+passed\b/g) };
}

function testWord(event: Event): string {
  const payload = event.payload as { status?: unknown; output?: unknown };
  const counts = testCounts(typeof payload.output === 'string' ? payload.output : '');
  if (payload.status === 'failed') return counts.failed !== null && counts.failed > 0 ? `${counts.failed} failing` : 'failing';
  if (payload.status === 'passed') return counts.passed !== null && counts.passed > 0 ? `${counts.passed} passing` : 'passing';
  return 'status unknown';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type BuildOptions = { now?: Date; id?: string; redact?: (text: string) => string };

// `sinceTs` null means the whole session. An update with no new developer prompt returns null.
// A status always returns an entry; with no events its lines are empty.
export function buildEntry(events: readonly Event[], sinceTs: string | null, kind: EntryKind, options: BuildOptions = {}): RecruiterEntry | null {
  const redact = options.redact ?? ((text: string) => redactString(text, []));
  const now = options.now ?? new Date();
  const sinceMs = sinceTs === null ? null : Date.parse(sinceTs);
  const window = events.filter((event) => sinceMs === null || Number.isNaN(sinceMs) || Date.parse(event.ts) > sinceMs);
  const prompts = window.filter(isPrompt);
  if (kind === 'update' && prompts.length === 0) return null;

  const lines: (RecruiterLine & { quote?: boolean })[] = [];
  const latest = prompts.findLast((event) => typeof event.payload.prompt === 'string' && event.payload.prompt.trim().length > 0);
  if (latest) {
    const quote = quotePrompt(String(latest.payload.prompt), redact);
    if (quote.length > 0) lines.push({ text: `Working on: "${quote}"`, cites: [latest.id], quote: true });
  }
  if (prompts.length > 0) lines.push({ text: plural(prompts.length, 'developer prompt', 'developer prompts'), cites: prompts.map((event) => event.id) });

  const edits = window.filter((event) => event.type === 'file_edit');
  const names: string[] = [];
  for (const edit of edits) {
    const files = (edit.payload as { files?: unknown }).files;
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      if (typeof file !== 'string') continue;
      const name = redact(normalize(baseName(file)).replace(CONTROL, ''));
      // A banned word in one file name drops only that name, not the whole line.
      if (name.length > 0 && !names.includes(name) && bannedReason(name) === null) names.push(name);
    }
  }
  if (names.length > 0) {
    const shown = names.slice(0, MAX_FILE_NAMES).join(', ');
    const more = names.length > MAX_FILE_NAMES ? ` and ${names.length - MAX_FILE_NAMES} more` : '';
    lines.push({ text: `Files changed: ${shown}${more}`, cites: edits.map((event) => event.id) });
  }

  const tests = window.filter((event) => event.type === 'test');
  if (tests.length > 0) {
    const first = tests[0];
    const last = tests[tests.length - 1];
    const text = first === last ? `Tests: ${testWord(first)}` : `Tests: ${testWord(first)} → ${testWord(last)}`;
    lines.push({ text, cites: [...new Set([first.id, last.id])] });
  }

  const asked = window.filter((event) => event.type === 'question' && event.source === 'devlens_question');
  const replies = window.filter((event) => event.type === 'answer' && event.source === 'devlens_question');
  const answered = replies.filter((event) => event.payload.action !== 'skip');
  const skipped = replies.length - answered.length;
  if (asked.length > 0 || replies.length > 0) {
    const skipText = skipped > 0 ? `, ${skipped} skipped` : '';
    lines.push({ text: `Agent questions: ${asked.length} asked, ${answered.length} answered${skipText}`, cites: [...asked, ...replies].map((event) => event.id) });
  }

  if (kind === 'status' && window.length > 0) {
    const last = window[window.length - 1];
    lines.push({ text: `Last activity: ${isoSeconds(last.ts)}`, cites: [last.id] });
  }

  // Last guard: every kept line passes the same filter the agent questions use.
  // The prompt quote is the developer's own words, so "fix" may stay in it; score, rank, and hire never do.
  const kept = lines
    .filter((line) => bannedReason(line.text, line.quote ? ['fix'] : []) === null && line.cites.length > 0)
    .map(({ text, cites }) => ({ text, cites }));
  if (kind === 'update' && kept.length === 0) return null;
  const ts = now.toISOString();
  return { id: options.id ?? `${kind}:${ts}`, kind, ts, since: sinceTs, lines: kept };
}
