import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Event } from '../../core/event';
import type { AgentContext } from './types';
import { normalize } from './validate';

export const MAX_EVENTS = 200;
export const MAX_REPO_FILES = 500;
export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 8 * 1024;
export const README_BYTES = 4 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.devlens']);
const MANIFESTS: { name: string; bytes: number }[] = [
  { name: 'package.json', bytes: MAX_FILE_BYTES },
  { name: 'requirements.txt', bytes: MAX_FILE_BYTES },
  { name: 'README.md', bytes: README_BYTES },
];

// Case-insensitive on every segment: macOS and Windows volumes keep the spelling the caller used.
export function isSecretPath(p: string): boolean {
  // NFKC first, so full-width and other look-alike spellings of .env, .ssh, .pem, and .key match.
  const parts = normalize(p).split(/[\\/]+/).filter((part) => part.length > 0).map((part) => part.toLowerCase());
  if (parts.includes('.ssh')) return true;
  const base = parts[parts.length - 1] ?? '';
  if (base.startsWith('.env') && base !== '.env.example') return true;
  return base.endsWith('.pem') || base.endsWith('.key');
}

export function readEvents(eventsPath: string, session_id: string): Event[] {
  if (!existsSync(eventsPath)) return [];
  const events: Event[] = [];
  for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as Event;
      if (event && typeof event.id === 'string' && event.session_id === session_id) events.push(event);
    } catch { /* skip a damaged line */ }
  }
  return events;
}

export function walkRepoFiles(projectDir: string, limit = MAX_REPO_FILES): string[] {
  const out: string[] = [];
  const queue: string[] = [''];
  while (queue.length > 0 && out.length < limit) {
    const rel = queue.shift() as string;
    let entries;
    try { entries = readdirSync(path.join(projectDir, rel), { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) break;
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        queue.push(next);
      } else if (entry.isFile() && !isSecretPath(next)) {
        out.push(next);
      }
    }
  }
  return out;
}

// Returns null when the file must not be read: secret path, outside the project, missing, not a regular file, or hard-linked.
export function readSafeFile(projectDir: string, requested: string, maxBytes: number): { path: string; text: string } | null {
  try {
    const rootReal = realpathSync(projectDir);
    const candidate = path.isAbsolute(requested) ? requested : path.join(projectDir, requested);
    if (isSecretPath(candidate)) return null;
    const real = realpathSync(candidate);
    const rel = path.relative(rootReal, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    if (isSecretPath(rel)) return null;
    const stat = statSync(real);
    if (!stat.isFile()) return null;
    if (stat.nlink > 1) return null; // a hard link can share the inode of a secret file under a safe name
    const fd = openSync(real, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const n = readSync(fd, buffer, 0, maxBytes, 0);
      return { path: rel.split(path.sep).join('/'), text: buffer.subarray(0, n).toString('utf8') };
    } finally { closeSync(fd); }
  } catch { return null; }
}

function touchedPaths(events: Event[]): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'file_edit' && event.type !== 'test') continue;
    const files = (event.payload as { files?: unknown }).files;
    if (!Array.isArray(files)) continue;
    for (const file of files) if (typeof file === 'string' && file.length > 0) seen.add(file);
  }
  return [...seen].reverse(); // newest first
}

export function buildContext(projectDir: string, session_id: string, allEvents: Event[]): AgentContext {
  // Keep the latest developer prompt in view even after a long turn: every question must cite one.
  const window = allEvents.slice(-MAX_EVENTS);
  const lastPrompt = allEvents.findLast((event) => event.actor === 'developer' && event.type === 'prompt');
  const events = lastPrompt && !window.includes(lastPrompt) ? [lastPrompt, ...window.slice(1)] : window;
  const files: { path: string; text: string }[] = [];
  const have = new Set<string>();
  const wanted = [
    ...touchedPaths(allEvents).map((p) => ({ p, bytes: MAX_FILE_BYTES })),
    ...MANIFESTS.map((m) => ({ p: m.name, bytes: m.bytes })),
  ];
  for (const { p, bytes } of wanted) {
    if (files.length >= MAX_FILES) break;
    const file = readSafeFile(projectDir, p, bytes);
    if (!file || have.has(file.path)) continue;
    have.add(file.path);
    files.push(file);
  }
  const answers = new Map<string, string>();
  for (const event of allEvents) {
    if (event.type !== 'answer') continue;
    const payload = event.payload as { question_id?: unknown; text?: unknown };
    if (typeof payload.question_id === 'string') answers.set(payload.question_id, typeof payload.text === 'string' ? payload.text : '');
  }
  const prior = allEvents
    .filter((event) => event.type === 'question')
    .map((event) => ({ question: String((event.payload as { text?: unknown }).text ?? ''), answer: answers.get(event.id) ?? null }));
  return { session_id, events, repo_files: walkRepoFiles(projectDir), files, prior };
}
