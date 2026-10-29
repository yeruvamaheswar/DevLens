import { redactString } from '../../capture/redact';
import type { Event } from '../../core/event';
import { bannedReason, normalize } from '../../agent/src/validate';

// Pure rules: no I/O, no model. Every line is a fact from the session log and cites the events it rests on.
// NOT-12: no score, rank, ratio, or verdict; no code, diffs, file contents, or tool output text.

export type EntryKind = 'update' | 'status';
// `prompt: true` marks a developer prompt, shown verbatim (redacted) so the reviewer sees how the developer worked.
export type RecruiterLine = { text: string; cites: string[]; prompt?: true };
export type RecruiterEntry = { id: string; kind: EntryKind; ts: string; since: string | null; lines: RecruiterLine[] };

export const PROMPT_CHARS = 2000;
export const MAX_PROMPTS = 20;
export const MAX_FILE_NAMES = 8;

const CONTROL = /[\p{Cc}]/gu;

function isoSeconds(ts: string): string {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const isPrompt = (event: Event) => event.actor === 'developer' && event.type === 'prompt';

// Extra patterns for free text a developer may paste into a prompt, beyond the capture redactor's named forms.
const PROMPT_SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, '[REDACTED]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[REDACTED]@'],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[REDACTED]'],
  [/\b(password|passwd|pwd|passphrase)(\s*(?:is|=|:)\s*)\S+/gi, '$1$2[REDACTED]'],
];
function redactPrompt(text: string, redact: (text: string) => string): string {
  return PROMPT_SECRETS.reduce((out, [pattern, to]) => out.replace(pattern, to), redact(text));
}

// Redact the raw text, keep line breaks, drop other control characters, collapse runs of spaces, redact again, then cut.
// Redacting before the cleanup matches secrets exactly as typed; redacting before the cut keeps a matched secret whole.
export function promptText(text: string, redact: (text: string) => string): string {
  const clean = normalize(redactPrompt(text, redact)).replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n]/gu, ' ').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const chars = [...redactPrompt(clean, redact)];
  return chars.length > PROMPT_CHARS ? `${chars.slice(0, PROMPT_CHARS).join('')}…` : chars.join('');
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

  const lines: RecruiterLine[] = [];
  // Every developer prompt in the window, verbatim and redacted, oldest first. Older ones beyond the cap become one count line.
  const written = prompts.filter((event) => typeof event.payload.prompt === 'string' && event.payload.prompt.trim().length > 0);
  const earlier = written.slice(0, Math.max(0, written.length - MAX_PROMPTS));
  if (earlier.length > 0) lines.push({ text: `and ${plural(earlier.length, 'earlier developer prompt', 'earlier developer prompts')}`, cites: earlier.map((event) => event.id) });
  for (const event of written.slice(earlier.length)) {
    const text = promptText(String(event.payload.prompt), redact);
    if (text.length > 0) lines.push({ text, cites: [event.id], prompt: true });
  }

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

  // Last guard: every DevLens-written line passes the same filter the agent questions use.
  // A prompt line is the developer's own words, labelled as such on the page, so the filter does not edit it.
  const kept = lines.filter((line) => line.cites.length > 0 && (line.prompt === true || bannedReason(line.text) === null));
  if (kind === 'update' && kept.length === 0) return null;
  const ts = now.toISOString();
  return { id: options.id ?? `${kind}:${ts}`, kind, ts, since: sinceTs, lines: kept };
}
