// Live capture. Polls the T3 database read-only and re-imports a thread when it changes.
// The import itself is injected (`importOnce`), so this file never maps events and never writes to T3.
// Each poll stamps `watch.updated_at` into capture.json. The journey API reads it to mark the capture live.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { listThreads, openT3 } from './store';

export type WatchOptions = {
  db: string;
  thread?: string;
  workspace?: string;
  outDir: (threadId: string) => string;
  importOnce: (threadId: string) => { events: number };
  intervalMs?: number;
  log?: (line: string) => void;
  now?: () => Date;
};

export type Watcher = { stop: () => Promise<void>; done: Promise<void> };

type Row = Record<string, number | string | null>;

// A cheap change marker for one thread: counts, statuses, and newest timestamps of its projections, plus its event stream's last sequence.
export function fingerprint(db: DatabaseSync, threadId: string): string {
  const one = (sql: string) => JSON.stringify(db.prepare(sql).get(threadId) as Row | undefined);
  return [
    one('SELECT updated_at FROM orchestration_v2_projection_threads WHERE thread_id = ?'),
    one("SELECT count(*) AS n, max(updated_at) AS at, sum(status = 'completed') AS done FROM orchestration_v2_projection_turn_items WHERE thread_id = ?"),
    one("SELECT count(*) AS n, max(coalesce(completed_at, requested_at)) AS at, sum(status = 'completed') AS done FROM orchestration_v2_projection_runs WHERE thread_id = ?"),
    one("SELECT count(*) AS n, max(captured_at) AS at, group_concat(status) AS statuses FROM orchestration_v2_projection_checkpoints WHERE thread_id = ?"),
    one('SELECT group_concat(status) AS statuses FROM orchestration_v2_projection_runs WHERE thread_id = ?'),
    // Every event on the thread's stream (model switches, renames) moves this, even when no projection row changes.
    one('SELECT max(sequence) AS seq FROM orchestration_events WHERE stream_id = ?'),
  ].join('|');
}

function stamp(file: string, at: Date): void {
  if (!existsSync(file)) return;
  const capture = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  capture.watch = { updated_at: at.toISOString() };
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(capture, null, 2) + '\n');
  renameSync(temp, file);
}

export function startWatch(options: WatchOptions): Watcher {
  const interval = options.intervalMs ?? 2000;
  const log = options.log ?? ((line: string) => console.error(line));
  const now = options.now ?? (() => new Date());
  const seen = new Map<string, string>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    wake = resolve;
  });

  function poll(): void {
    let threadId = options.thread ?? null;
    try {
      const db = openT3(options.db);
      try {
        if (!threadId) threadId = listThreads(db, options.workspace)[0]?.thread_id ?? null;
        if (!threadId) {
          log(`${now().toISOString()} no T3 thread found yet`);
          return;
        }
        const marker = fingerprint(db, threadId);
        if (marker !== seen.get(threadId)) {
          db.close();
          const result = options.importOnce(threadId);
          seen.set(threadId, marker);
          log(`${now().toISOString()} re-imported thread ${threadId} events=${result.events}`);
        }
      } finally {
        try {
          db.close();
        } catch {
          // Already closed before the import.
        }
      }
      stamp(path.join(options.outDir(threadId), 'capture.json'), now());
    } catch (error) {
      log(`${now().toISOString()} watch error${threadId ? ` (thread ${threadId})` : ''}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function tick(): void {
    if (stopped) return;
    poll();
    if (!stopped) timer = setTimeout(tick, interval);
  }
  tick();

  return {
    done,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      log(`${now().toISOString()} watch stopped`);
    },
  };
}
