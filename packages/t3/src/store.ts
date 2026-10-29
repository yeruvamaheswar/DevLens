// Read-only access to the T3 Code server's local state database.
// T3 Code keeps an event log and projections in SQLite. DevLens opens it read-only and never writes.
// This schema is internal to T3 Code, not a published API. Checked against T3 Code 0.1.3 (migration 69).
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_T3_DB = path.join(homedir(), '.t3', 'userdata', 'statev2.sqlite');
export const CHECKED_MIGRATION = 69;

export type T3Project = { project_id: string; title: string; workspace_root: string };
export type T3Thread = {
  thread_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
};
export type T3Run = {
  run_id: string;
  ordinal: number;
  provider: string;
  provider_thread_id: string | null;
  status: string;
  requested_at: string;
  completed_at: string | null;
  payload: Record<string, unknown>;
};
export type T3Item = {
  turn_item_id: string;
  run_id: string | null;
  ordinal: number;
  type: string;
  status: string;
  updated_at: string;
  payload: Record<string, unknown>;
};
export type T3Checkpoint = {
  checkpoint_id: string;
  run_id: string | null;
  status: string;
  captured_at: string;
  payload: Record<string, unknown>;
};
export type T3SelectionChange = { event_id: string; event_type: string; occurred_at: string; payload: Record<string, unknown> };
export type T3ThreadSnapshot = {
  migration: number | null;
  thread: T3Thread;
  project: T3Project | null;
  runs: T3Run[];
  items: T3Item[];
  checkpoints: T3Checkpoint[];
  selection_changes: T3SelectionChange[];
};
export type T3ThreadSummary = { thread_id: string; title: string; project_title: string | null; workspace_root: string | null; updated_at: string; runs: number };

const REQUIRED: Record<string, string[]> = {
  orchestration_v2_projection_threads: ['thread_id', 'project_id', 'title', 'created_at', 'updated_at', 'deleted_at', 'payload_json'],
  orchestration_v2_projection_runs: ['run_id', 'thread_id', 'ordinal', 'provider', 'provider_thread_id', 'status', 'requested_at', 'completed_at', 'payload_json'],
  orchestration_v2_projection_turn_items: ['turn_item_id', 'thread_id', 'run_id', 'ordinal', 'type', 'status', 'updated_at', 'payload_json'],
  orchestration_v2_projection_checkpoints: ['checkpoint_id', 'thread_id', 'run_id', 'status', 'captured_at', 'payload_json'],
  orchestration_events: ['sequence', 'event_id', 'stream_id', 'event_type', 'occurred_at', 'payload_json'],
};

export class T3SchemaError extends Error {}

function parse(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string') return {};
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function openT3(dbPath: string = DEFAULT_T3_DB): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  checkSchema(db);
  return db;
}

// Fails closed: a missing table or column means this T3 version is not supported.
export function checkSchema(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(REQUIRED)) {
    const found = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
    if (found.size === 0) throw new T3SchemaError(`T3 database has no table ${table}. This T3 Code version is not supported.`);
    const missing = columns.filter((column) => !found.has(column));
    if (missing.length > 0) throw new T3SchemaError(`T3 table ${table} lacks ${missing.join(', ')}. This T3 Code version is not supported.`);
  }
}

export function migrationOf(db: DatabaseSync): number | null {
  try {
    const row = db.prepare('SELECT max(migration_id) AS id FROM effect_sql_migrations').get() as { id: number | null } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// Projects live only in the event log in this version: the latest create or meta update wins.
function projects(db: DatabaseSync): Map<string, T3Project> {
  const rows = db
    .prepare("SELECT event_type, payload_json FROM orchestration_events WHERE event_type IN ('project.created', 'project.meta-updated', 'project.deleted') ORDER BY sequence")
    .all() as { event_type: string; payload_json: string }[];
  const found = new Map<string, T3Project>();
  for (const row of rows) {
    const payload = parse(row.payload_json);
    const id = typeof payload.projectId === 'string' ? payload.projectId : null;
    if (!id) continue;
    if (row.event_type === 'project.deleted') {
      found.delete(id);
      continue;
    }
    const prior = found.get(id);
    found.set(id, {
      project_id: id,
      title: typeof payload.title === 'string' ? payload.title : prior?.title ?? '',
      workspace_root: typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot : prior?.workspace_root ?? '',
    });
  }
  return found;
}

export function listThreads(db: DatabaseSync, workspaceRoot?: string): T3ThreadSummary[] {
  const all = projects(db);
  const rows = db
    .prepare(
      `SELECT t.thread_id, t.project_id, t.title, t.updated_at, (SELECT count(*) FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id) AS runs
       FROM orchestration_v2_projection_threads t WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC`,
    )
    .all() as { thread_id: string; project_id: string; title: string; updated_at: string; runs: number }[];
  const wanted = workspaceRoot ? path.resolve(workspaceRoot) : null;
  return rows
    .map((row) => {
      const project = all.get(row.project_id) ?? null;
      return { thread_id: row.thread_id, title: row.title, project_title: project?.title ?? null, workspace_root: project?.workspace_root ?? null, updated_at: row.updated_at, runs: row.runs };
    })
    .filter((row) => wanted == null || (row.workspace_root != null && path.resolve(row.workspace_root) === wanted));
}

export function readThread(db: DatabaseSync, threadId: string): T3ThreadSnapshot {
  const thread = db.prepare('SELECT thread_id, project_id, title, created_at, updated_at, payload_json FROM orchestration_v2_projection_threads WHERE thread_id = ?').get(threadId) as
    | { thread_id: string; project_id: string; title: string; created_at: string; updated_at: string; payload_json: string }
    | undefined;
  if (!thread) throw new Error(`No T3 thread ${threadId}`);
  const runs = (
    db
      .prepare('SELECT run_id, ordinal, provider, provider_thread_id, status, requested_at, completed_at, payload_json FROM orchestration_v2_projection_runs WHERE thread_id = ? ORDER BY ordinal')
      .all(threadId) as (Omit<T3Run, 'payload'> & { payload_json: string })[]
  ).map(({ payload_json, ...row }) => ({ ...row, payload: parse(payload_json) }));
  const items = (
    db
      .prepare('SELECT turn_item_id, run_id, ordinal, type, status, updated_at, payload_json FROM orchestration_v2_projection_turn_items WHERE thread_id = ? ORDER BY ordinal')
      .all(threadId) as (Omit<T3Item, 'payload'> & { payload_json: string })[]
  ).map(({ payload_json, ...row }) => ({ ...row, payload: parse(payload_json) }));
  const checkpoints = (
    db
      .prepare('SELECT checkpoint_id, run_id, status, captured_at, payload_json FROM orchestration_v2_projection_checkpoints WHERE thread_id = ? ORDER BY captured_at')
      .all(threadId) as (Omit<T3Checkpoint, 'payload'> & { payload_json: string })[]
  ).map(({ payload_json, ...row }) => ({ ...row, payload: parse(payload_json) }));
  const selection_changes = (
    db
      .prepare(
        `SELECT event_id, event_type, occurred_at, payload_json FROM orchestration_events
         WHERE event_type IN ('thread.model-selection-updated', 'thread.provider-switched') AND json_extract(payload_json, '$.id') = ? ORDER BY sequence`,
      )
      .all(threadId) as { event_id: string; event_type: string; occurred_at: string; payload_json: string }[]
  ).map(({ payload_json, ...row }) => ({ ...row, payload: parse(payload_json) }));
  const { payload_json, ...head } = thread;
  return {
    migration: migrationOf(db),
    thread: { ...head, payload: parse(payload_json) },
    project: projects(db).get(thread.project_id) ?? null,
    runs,
    items,
    checkpoints,
    selection_changes,
  };
}
