// Synthetic T3 rows in a temporary database, written by hand. Not a captured session.
// EVAL-1: a new turn item shows in the capture (and in loadJourney) within 10 s of the watcher.
// EVAL-2: after changes stop, the watched capture equals a one-shot import.
// The watcher opens the database read-only only.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const opens: { path: string; readOnly: boolean }[] = [];
vi.mock('node:sqlite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:sqlite')>();
  class Recording extends actual.DatabaseSync {
    constructor(file: string, options?: { readOnly?: boolean }) {
      if (options) super(file, options);
      else super(file);
      opens.push({ path: String(file), readOnly: options?.readOnly === true });
    }
  }
  return { ...actual, DatabaseSync: Recording };
});

import { isLive, loadJourney } from '../../../apps/web/journey/sources';
import { runImport, type ImportOptions } from '../src/cli';
import { startWatch } from '../src/watch';

const T = `watch-test-${process.pid}-${Date.now()}`;
const dir = mkdtempSync(path.join(tmpdir(), 'devlens-t3-watch-'));
const file = path.join(dir, 'state.sqlite');
const out = path.join(process.cwd(), '.devlens', 't3', T); // loadJourney reads from here
const oneShot = path.join(dir, 'one-shot');

function create(): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, provider TEXT, provider_thread_id TEXT, status TEXT, requested_at TEXT, completed_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, ordinal INTEGER, type TEXT, status TEXT, updated_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_checkpoints (checkpoint_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, status TEXT, captured_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, stream_id TEXT, event_type TEXT, occurred_at TEXT, payload_json TEXT);
    INSERT INTO effect_sql_migrations VALUES (69, 'x');
  `);
  db.prepare('INSERT INTO orchestration_events (event_id, event_type, occurred_at, payload_json) VALUES (?, ?, ?, ?)').run('e1', 'project.created', 't', JSON.stringify({ projectId: 'p1', title: 'demo', workspaceRoot: '/nonexistent/devlens-watch-test' }));
  db.prepare('INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?, ?, NULL, ?)').run(T, 'p1', 'Watch me', '2026-10-29T15:00:00.000Z', '2026-10-29T15:00:00.000Z', '{}');
  db.prepare('INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run:1', T, 1, 'claudeAgent', null, 'running', '2026-10-29T15:00:00.000Z', null, JSON.stringify({ modelSelection: { instanceId: 'claudeAgent', model: 'm' } }));
  addItem(db, 1, 'user_message', { createdBy: 'user', creationSource: 'web', text: 'Please run the tests.' }, null);
  return db;
}

function addItem(db: DatabaseSync, n: number, type: string, payload: Record<string, unknown>, native: object | null = { driver: 'claudeAgent', nativeId: `toolu_${n}`, strength: 'strong' }) {
  const at = `2026-10-29T15:00:${String(n).padStart(2, '0')}.000Z`;
  db.prepare('INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`item-${n}`, T, 'run:1', n, type, 'completed', at, JSON.stringify({ type, nativeItemRef: native, startedAt: at, completedAt: at, ...payload }));
  db.prepare('UPDATE orchestration_v2_projection_threads SET updated_at = ? WHERE thread_id = ?').run(at, T);
}

const options = (target: string): ImportOptions => ({ threadId: T, out: target, db: file, root: null, recording: null, rerun: null, noGit: true, noCheckpoints: true });
const ids = (target: string) => (existsSync(path.join(target, 'events.jsonl')) ? readFileSync(path.join(target, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { id: string }).id) : []);
async function until(check: () => boolean, ms: number): Promise<number> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return Date.now() - start;
}

describe('t3 watch', () => {
  beforeAll(() => {
    create().close();
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('shows a new turn item within 10 s, then matches a one-shot import, read-only', async () => {
    const lines: string[] = [];
    opens.length = 0;
    const watcher = startWatch({ db: file, thread: T, outDir: () => out, intervalMs: 100, log: (line) => lines.push(line), importOnce: (id) => ({ events: runImport({ ...options(out), threadId: id }).events.length }) });
    try {
      await until(() => ids(out).some((id) => id.endsWith(':item-1')), 10_000);
      expect(ids(out)).not.toContain(`t3:${T}:item-2`);

      // EVAL-1: the session adds a turn item while the watcher runs.
      const db = new DatabaseSync(file);
      addItem(db, 2, 'command_execution', { input: 'echo hi', output: 'hi' });
      db.close();
      const waited = await until(() => ids(out).includes(`t3:${T}:item-2`), 10_000);
      expect(waited).toBeLessThan(10_000);
      const journey = await loadJourney(`t3:${T}`);
      expect(journey?.events.map((event) => event.id)).toContain(`t3:${T}:item-2`);
      expect(journey?.journey.source.live).toBe(true);

      // The log names each re-import.
      expect(lines.some((line) => line.includes(`re-imported thread ${T}`) && /events=\d+/.test(line))).toBe(true);

      // Polls with no change still stamp the capture.
      const first = (JSON.parse(readFileSync(path.join(out, 'capture.json'), 'utf8')) as { watch: { updated_at: string } }).watch.updated_at;
      await until(() => (JSON.parse(readFileSync(path.join(out, 'capture.json'), 'utf8')) as { watch: { updated_at: string } }).watch.updated_at !== first, 5_000);
    } finally {
      await watcher.stop();
    }

    // EVAL-2: the watched capture equals a one-shot import (same ids and payloads).
    runImport(options(oneShot));
    expect(readFileSync(path.join(out, 'events.jsonl'), 'utf8')).toBe(readFileSync(path.join(oneShot, 'events.jsonl'), 'utf8'));
    expect(readFileSync(path.join(out, 'edges.jsonl'), 'utf8')).toBe(readFileSync(path.join(oneShot, 'edges.jsonl'), 'utf8'));

    // Read-only: every open of T3's database during the watch used readOnly. Only the test's own fixture write above is writable.
    const watcherOpens = opens.filter((open) => open.path === file && open.readOnly);
    expect(watcherOpens.length).toBeGreaterThan(2);
    expect(opens.filter((open) => open.path === file && !open.readOnly)).toHaveLength(1); // the fixture insert in this test
    const ro = new DatabaseSync(file, { readOnly: true });
    expect(() => ro.exec("INSERT INTO effect_sql_migrations VALUES (70, 'y')")).toThrow();
    ro.close();
  });

  it('logs a read error and keeps going', async () => {
    const lines: string[] = [];
    const watcher = startWatch({ db: path.join(dir, 'missing.sqlite'), thread: T, outDir: () => out, intervalMs: 50, log: (line) => lines.push(line), importOnce: () => ({ events: 0 }) });
    await until(() => lines.filter((line) => line.includes('watch error')).length >= 2, 5_000);
    await watcher.stop();
    expect(lines.some((line) => line.includes('watch stopped'))).toBe(true);
  });

  it('marks a capture live only for 15 s after the stamp', () => {
    const now = Date.parse('2026-10-29T12:00:30.000Z');
    expect(isLive('2026-10-29T12:00:20.000Z', now)).toBe(true);
    expect(isLive('2026-10-29T12:00:10.000Z', now)).toBe(false);
    expect(isLive(undefined, now)).toBe(false);
  });
});

describe('watch --interval (review finding 6)', async () => {
  const { parseInterval } = await import('../src/cli');
  it('defaults to 2 s and rejects a missing, non-numeric, or tiny value', () => {
    expect(parseInterval(undefined)).toBe(2000);
    expect(parseInterval('500')).toBe(500);
    for (const raw of [true, 'abc', '0', '10', '-5'] as const) expect(() => parseInterval(raw), String(raw)).toThrow(/at least 250/);
  });
});
