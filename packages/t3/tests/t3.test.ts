// Synthetic T3 rows, written by hand for these tests. They are not a captured session.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { linkEvents } from '../../link/src/rules';
import { diffOf, isTestRun, mapThread, relativePath } from '../src/map';
import { checkSchema, readThread, T3SchemaError, type T3Item, type T3ThreadSnapshot } from '../src/store';

const ROOT = '/work/sprintboard-demo';
const T = 'thread-1';

function run(ordinal: number, model: string, provider = 'claudeAgent', status = 'completed') {
  return {
    run_id: `run:${ordinal}`,
    ordinal,
    provider,
    provider_thread_id: `pt:${ordinal}`,
    status,
    requested_at: `2026-10-29T15:0${ordinal}:00.000Z`,
    completed_at: null,
    payload: { modelSelection: { instanceId: provider, model, options: [{ id: 'effort', value: 'medium' }] } },
  };
}

let n = 0;
function item(runNo: number, type: string, payload: Record<string, unknown>, extra: Partial<T3Item> = {}): T3Item {
  n += 1;
  const at = `2026-10-29T15:0${runNo}:${String(n).padStart(2, '0')}.000Z`;
  const native = type === 'user_message' ? null : { driver: 'claudeAgent', nativeId: `toolu_${n}`, strength: 'strong' };
  return {
    turn_item_id: `item-${n}`,
    run_id: `run:${runNo}`,
    ordinal: runNo * 1_000_000 + n,
    type,
    status: 'completed',
    updated_at: at,
    payload: { type, nativeItemRef: native, startedAt: at, completedAt: at, ...payload },
    ...extra,
  };
}

const FAIL_OUT = 'not ok 1 - in-progress filter\nAssertionError [ERR_ASSERTION]: expected 200, got 400\nℹ pass 9\nℹ fail 1';
const PASS_OUT = 'ℹ tests 10\nℹ pass 10\nℹ fail 0';

function snapshot(): T3ThreadSnapshot {
  n = 0;
  return {
    migration: 69,
    thread: { thread_id: T, project_id: 'p1', title: 'Fix status filter', created_at: '2026-10-29T15:00:00.000Z', updated_at: '2026-10-29T15:09:00.000Z', payload: { branch: 'main', worktreePath: null } },
    project: { project_id: 'p1', title: 'sprintboard-demo', workspace_root: ROOT },
    runs: [run(1, 'claude-sonnet-5-5'), run(2, 'claude-sonnet-5-5'), run(3, 'gpt-6.1-sol', 'codex')],
    items: [
      item(1, 'user_message', { createdBy: 'user', creationSource: 'web', text: 'The In progress filter is broken. Run npm test.' }),
      item(1, 'command_execution', { input: 'npm test', output: FAIL_OUT }, { status: 'failed' }),
      item(1, 'dynamic_tool', { toolName: 'Read', title: 'Read src/validate.js' }),
      item(1, 'file_change', { fileName: `${ROOT}/src/validate.js`, diffStr: JSON.stringify({ filePath: `${ROOT}/src/validate.js`, oldString: "'in_progress'", newString: "'in_progress', 'in-progress'" }) }),
      item(1, 'file_change', { fileName: `${ROOT}/src/issues.js`, diffStr: '{"message":"ambiguous"}' }, { status: 'failed' }),
      item(1, 'command_execution', { input: 'npm test', output: 'AssertionError [ERR_ASSERTION]: expected 3 issues, got 0\nℹ pass 9\nℹ fail 1' }, { status: 'failed' }),
      item(2, 'user_message', { createdBy: 'user', creationSource: 'web', text: 'Statuses are stored as in_progress. Normalize once.' }),
      item(2, 'file_change', { fileName: `${ROOT}/src/status.js`, diffStr: '--- a/src/status.js\n+++ b/src/status.js\n@@ -0,0 +1 @@\n+export const x = 1;' }),
      item(2, 'command_execution', { input: 'npm test', output: PASS_OUT }),
      item(2, 'command_execution', { input: 'echo hi' }, { status: 'running' }),
      item(3, 'user_message', { createdBy: 'agent', creationSource: 'mcp', text: 'Review the change.' }),
      item(3, 'command_execution', { input: 'Workspace ready', output: 'done' }, { payload: { type: 'command_execution', nativeItemRef: null, input: 'Workspace ready' } }),
    ],
    checkpoints: [
      { checkpoint_id: 'cp-1', run_id: 'run:1', status: 'ready', captured_at: '2026-10-29T15:01:59.000Z', payload: { ref: 'refs/t3/x/ordinal/1', files: [{ path: 'src/validate.js', kind: 'modified' }, { path: 'data/seed.json', kind: 'modified' }] } },
    ],
    selection_changes: [],
  };
}

describe('T3 mapping (synthetic rows)', () => {
  const { events, capture } = mapThread(snapshot(), { now: new Date('2026-10-29T16:00:00.000Z') });
  const byType = (type: string) => events.filter((event) => event.type === type);

  it('keeps T3 and provider ids and one session per thread', () => {
    expect(new Set(events.map((event) => event.session_id))).toEqual(new Set(['t3:thread-1']));
    const test = byType('test')[0];
    expect(test.id).toBe('t3:thread-1:item-2');
    expect(test.tool_use_id).toBe('toolu_2');
    expect((test.payload.t3 as Record<string, unknown>).run_id).toBe('run:1');
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  });

  it('labels prompts by who T3 says wrote them', () => {
    const prompts = byType('prompt');
    expect(prompts.map((event) => event.actor)).toEqual(['developer', 'developer', 'agent']);
    expect(prompts[2].payload.attribution).toBe('agent_authored');
    expect(prompts[0].payload.prompt).toBe('The In progress filter is broken. Run npm test.');
  });

  it('turns test commands into test events with the output status', () => {
    const tests = byType('test');
    expect(tests.map((event) => event.payload.status)).toEqual(['failed', 'failed', 'passed']);
    expect(tests.every((event) => event.payload.signal === 'output_parse')).toBe(true);
  });

  it('keeps a failed edit as a tool call, not an edit', () => {
    const edits = byType('file_edit').filter((event) => event.actor === 'agent');
    expect(edits.map((event) => event.payload.files)).toEqual([['src/validate.js'], ['src/status.js']]);
    expect(byType('tool_call').some((event) => event.payload.tool_name === 'file_change' && event.payload.applied === false)).toBe(true);
  });

  it('records the provider and model of each run and the switch between them', () => {
    expect(byType('prompt')[2].payload.agent).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol', run_ordinal: 3 });
    expect(capture.model_switches).toEqual([{ at_run: 3, from: 'claudeAgent · claude-sonnet-5-5', to: 'codex · gpt-6.1-sol' }]);
  });

  it('marks checkpoint files with no provider edit as unattributed and inferred', () => {
    const unattributed = events.filter((event) => event.payload.attribution === 'unattributed' && event.type === 'file_edit');
    expect(unattributed.map((event) => event.payload.files)).toEqual([['data/seed.json']]);
    expect(unattributed[0].actor).toBe('unknown');
    expect(unattributed[0].provenance).toBe('inferred');
    expect(byType('checkpoint')).toHaveLength(1);
  });

  it('leaves out running items and T3 bookkeeping, and says so', () => {
    expect(capture.skipped).toMatchObject({ running: 1, internal: 1 });
    expect(capture.unknowns.some((line) => line.includes('still running'))).toBe(true);
    expect(capture.unknowns.some((line) => line.includes('written by an agent'))).toBe(true);
  });

  it('is deterministic, so a re-import replaces events by id', () => {
    const again = mapThread(snapshot(), { now: new Date('2026-10-29T16:00:00.000Z') });
    expect(again.events).toEqual(events);
  });

  it('feeds the same link rules as Claude Code hooks', () => {
    const edges = linkEvents(events.map((event, index) => ({ ...event, seq: index + 1 })));
    expect(edges.some((edge) => edge.rel === 'prompted')).toBe(true);
    expect(edges.some((edge) => edge.rel === 'verifies' || edge.rel === 'ran_test')).toBe(true);
  });
});

describe('T3 diff shapes and paths', () => {
  it('reads old/new, written content, and unified diffs, and names a missing diff', () => {
    expect(diffOf(JSON.stringify({ oldString: 'a', newString: 'b' }), ROOT)).toEqual({ diff: '-a\n+b', format: 'old_new' });
    expect(diffOf(JSON.stringify({ type: 'create', content: 'x\ny\n' }), ROOT)).toEqual({ diff: '+x\n+y', format: 'written_content' });
    expect(diffOf(`--- a${ROOT}/f\n+++ b${ROOT}/f\n@@ -1 +1 @@\n-a\n+b`, ROOT).format).toBe('unified');
    expect(diffOf('File created successfully at: /x', ROOT)).toEqual({ diff: null, format: 'not_exposed' });
  });

  it('keeps paths inside the checkout relative and hides paths outside it', () => {
    expect(relativePath(`${ROOT}/src/a.js`, ROOT)).toBe('src/a.js');
    expect(relativePath('/Users/someone/secret/notes.md', ROOT)).toBe('(outside project) notes.md');
  });
});

describe('T3 store (temporary database)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-t3-'));
  const file = path.join(dir, 'state.sqlite');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function create(withRunsPayload = true) {
    const db = new DatabaseSync(file);
    db.exec(`
      DROP TABLE IF EXISTS orchestration_v2_projection_threads; DROP TABLE IF EXISTS orchestration_v2_projection_runs;
      DROP TABLE IF EXISTS orchestration_v2_projection_turn_items; DROP TABLE IF EXISTS orchestration_v2_projection_checkpoints;
      DROP TABLE IF EXISTS orchestration_events; DROP TABLE IF EXISTS effect_sql_migrations;
      CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, payload_json TEXT);
      CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, provider TEXT, provider_thread_id TEXT, status TEXT, requested_at TEXT, completed_at TEXT${withRunsPayload ? ', payload_json TEXT' : ''});
      CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, ordinal INTEGER, type TEXT, status TEXT, updated_at TEXT, payload_json TEXT);
      CREATE TABLE orchestration_v2_projection_checkpoints (checkpoint_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, status TEXT, captured_at TEXT, payload_json TEXT);
      CREATE TABLE orchestration_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, event_type TEXT, occurred_at TEXT, payload_json TEXT);
      INSERT INTO effect_sql_migrations VALUES (69, 'x');
    `);
    return db;
  }

  it('reads one thread with its project, runs, items, and checkpoints', () => {
    const db = create();
    db.prepare('INSERT INTO orchestration_events (event_id, event_type, occurred_at, payload_json) VALUES (?, ?, ?, ?)').run('e1', 'project.created', 't', JSON.stringify({ projectId: 'p1', title: 'demo', workspaceRoot: ROOT }));
    db.prepare('INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?, ?, NULL, ?)').run(T, 'p1', 'Fix', 'a', 'b', '{}');
    db.prepare('INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run:1', T, 1, 'claudeAgent', null, 'completed', 'a', null, JSON.stringify({ modelSelection: { model: 'm' } }));
    db.prepare('INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('i1', T, 'run:1', 1, 'user_message', 'completed', 'a', JSON.stringify({ text: 'hi', createdBy: 'user' }));
    db.close();
    const ro = new DatabaseSync(file, { readOnly: true });
    checkSchema(ro);
    const snap = readThread(ro, T);
    ro.close();
    expect(snap.migration).toBe(69);
    expect(snap.project?.workspace_root).toBe(ROOT);
    expect(snap.runs[0].payload).toEqual({ modelSelection: { model: 'm' } });
    expect(snap.items.map((row) => row.type)).toEqual(['user_message']);
  });

  it('fails closed when T3 changes a column it depends on', () => {
    create(false).close();
    const ro = new DatabaseSync(file, { readOnly: true });
    expect(() => checkSchema(ro)).toThrow(T3SchemaError);
    ro.close();
  });

  it('cannot write: the database is opened read-only', () => {
    create().close();
    const ro = new DatabaseSync(file, { readOnly: true });
    expect(() => ro.exec("INSERT INTO effect_sql_migrations VALUES (70, 'y')")).toThrow();
    ro.close();
  });
});

describe('T3 test detection (review finding 1 and 7)', () => {
  it('counts only a single test runner call as a test run', () => {
    for (const command of ['npm test', 'cd /work/sprintboard-demo && npm test', 'npm test 2>&1 | tail -20', 'CI=1 npx vitest run', 'node --no-warnings=ExperimentalWarning --test', 'pytest -q', 'npm run test:t3']) {
      expect(isTestRun(command), command).toBe(true);
    }
    for (const command of [
      'cd /x; grep -n "redactEditText(" a.ts; cp a b; sed -i \'\' s/a/b/ c.ts',
      'cat /private/tmp/claude-1/out.txt',
      'D=/tmp/x; mkdir -p $D; cat > package.json <<EOF\n{}\nEOF',
      'echo npm test',
      'npm test && npm run build',
      'grep -r vitest package.json',
    ]) {
      expect(isTestRun(command), command).toBe(false);
    }
  });

  it('does not claim a pass when the provider says the command failed', () => {
    const snap = snapshot();
    snap.items = [item(1, 'command_execution', { input: 'npm test', output: 'ℹ pass 10\nℹ fail 0' }, { status: 'failed' })];
    const { events } = mapThread(snap);
    expect(events[0].payload).toMatchObject({ status: 'unknown', signal: 'provider_status' });
  });
});
