// Pure mapping of one T3 Code thread into DevLens events. No I/O.
// One T3 thread is one DevLens session. Each run keeps the provider and model T3 recorded for it.
// Provider tool reports, T3 git checkpoints, and the developer's prompts stay separate kinds of evidence.
import path from 'node:path';
import type { Event } from '../../core/event';
import { testStatusFromOutput } from '../../capture/map-hook';
import type { T3Item, T3Run, T3ThreadSnapshot } from './store';
import { CHECKED_MIGRATION } from './store';

export const ADAPTER = 't3_code';
export const ADAPTER_VERSION = 1;
const MAX_DIFF = 4000;
const MAX_OUTPUT = 8000;
const MAX_TOOL_OUTPUT = 1500;
const TOOL_TYPES = new Set(['dynamic_tool', 'web_search', 'file_search', 'subagent', 'todo_list']);
const IGNORED_TYPES = new Set(['assistant_message', 'reasoning', 'compaction', 'notification', 'system_notice', 'handoff', 'proposed_plan', 'checkpoint']);

export type AgentIdentity = {
  provider: string; // T3 provider instance id, for example claudeAgent, codex, cursor
  model: string | null;
  options: Record<string, string | boolean>;
  run_id: string;
  run_ordinal: number;
  run_status: string;
  provider_thread_id: string | null;
  basis: 'model selection T3 recorded for this run';
};

export type CaptureRun = AgentIdentity & { requested_at: string; completed_at: string | null; prompt_by: string | null };

export type T3Capture = {
  adapter: typeof ADAPTER;
  adapter_version: number;
  imported_at: string;
  label: string;
  t3: {
    thread_id: string;
    title: string;
    project_id: string;
    project_title: string | null;
    workspace: string | null; // folder name only
    branch: string | null;
    worktree: boolean;
    migration: number | null;
    checked_migration: number;
  };
  runs: CaptureRun[];
  model_switches: { at_run: number; from: string; to: string }[];
  unknowns: string[];
  not_captured: string[];
  skipped: { running: number; internal: number; ignored: Record<string, number> };
  recording: { recording_ref: string; mode: string } | null;
  rerun: boolean;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated by DevLens, ${value.length - max} more characters]`;
}

export function agentOf(run: T3Run): AgentIdentity {
  const selection = record(run.payload.modelSelection);
  const options: Record<string, string | boolean> = {};
  if (Array.isArray(selection.options)) {
    for (const option of selection.options) {
      const item = record(option);
      if (typeof item.id === 'string' && (typeof item.value === 'string' || typeof item.value === 'boolean')) options[item.id] = item.value;
    }
  }
  return {
    provider: str(selection.instanceId) ?? run.provider,
    model: str(selection.model),
    options,
    run_id: run.run_id,
    run_ordinal: run.ordinal,
    run_status: run.status,
    provider_thread_id: run.provider_thread_id,
    basis: 'model selection T3 recorded for this run',
  };
}

export function modelLabel(agent: Pick<AgentIdentity, 'provider' | 'model'>): string {
  return `${agent.provider} · ${agent.model ?? 'model unknown'}`;
}

// Paths become relative to the thread's checkout. A path outside it keeps only its file name.
export function relativePath(file: string, root: string | null): string {
  if (!root || !path.isAbsolute(file)) return file;
  const rel = path.relative(root, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? `(outside project) ${path.basename(file)}` : rel;
}

function prefixed(text: string, mark: '+' | '-'): string {
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').map((line) => `${mark}${line}`).join('\n');
}

// Providers report edits in different shapes. Keep what the provider gave and name the shape.
export function diffOf(diffStr: unknown, root: string | null): { diff: string | null; format: 'unified' | 'old_new' | 'written_content' | 'not_exposed' } {
  const raw = typeof diffStr === 'string' ? diffStr : '';
  if (!raw) return { diff: null, format: 'not_exposed' };
  if (/^(---|diff --git) /m.test(raw) && /^@@ /m.test(raw)) {
    const cleaned = root ? raw.split(root + '/').join('').split(root).join('.') : raw;
    return { diff: clip(cleaned, MAX_DIFF), format: 'unified' };
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = record(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (parsed) {
    const oldText = typeof parsed.oldString === 'string' ? parsed.oldString : null;
    const newText = typeof parsed.newString === 'string' ? parsed.newString : null;
    if (oldText !== null && newText !== null) return { diff: clip(`${prefixed(oldText, '-')}\n${prefixed(newText, '+')}`, MAX_DIFF), format: 'old_new' };
    if (typeof parsed.content === 'string') return { diff: clip(prefixed(parsed.content, '+'), MAX_DIFF), format: 'written_content' };
  }
  return { diff: null, format: 'not_exposed' };
}

const RUNNER = /^(?:npm\s+(?:test|t|run\s+test[\w:.-]*)|npx\s+(?:vitest|jest)|vitest|jest|pytest|python3?\s+-m\s+pytest|node\s+(?:--[\w=.-]+\s+)*--test)(?:\s|$)/;
const OUTPUT_TAIL = /\s*(?:2>&1\s*)?(?:\|\s*(?:tail|head|cat)\b[^|]*)*$/;

// T3 shells run long compound scripts. A command counts as a test run only when, apart from
// `cd` steps and an output tail such as `| tail -20`, it is one test runner call. Anything else is a tool call.
export function isTestRun(command: string): boolean {
  if (command.includes('\n') || command.includes('<<')) return false;
  const steps = command.split(/&&|;|\|\|/).map((step) => step.trim()).filter(Boolean);
  const work = steps.filter((step) => !/^cd(?:\s|$)/.test(step));
  if (work.length !== 1) return false;
  const step = work[0].replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').replace(OUTPUT_TAIL, '').trim();
  return RUNNER.test(step) && !step.includes('|');
}

function tsOf(item: T3Item, prefer: 'start' | 'end'): string {
  const start = str(item.payload.startedAt);
  const end = str(item.payload.completedAt);
  return (prefer === 'end' ? end ?? start : start ?? end) ?? item.updated_at;
}

function nativeOf(item: T3Item): { driver: string | null; native_id: string | null } {
  const ref = record(item.payload.nativeItemRef);
  return { driver: str(ref.driver), native_id: str(ref.nativeId) };
}

export function mapThread(snapshot: T3ThreadSnapshot, options: { now?: Date; root?: string; checkpoints?: boolean } = {}): { events: Event[]; capture: T3Capture } {
  const thread = snapshot.thread;
  const session = `t3:${thread.thread_id}`;
  const projectId = `t3-project:${thread.project_id}`;
  const worktree = str(thread.payload.worktreePath);
  const root = options.root ?? worktree ?? snapshot.project?.workspace_root ?? null;
  const useCheckpoints = options.checkpoints ?? true;
  const runs = new Map(snapshot.runs.map((run) => [run.run_id, run]));
  const agents = new Map(snapshot.runs.map((run) => [run.run_id, agentOf(run)]));
  const unknowns: string[] = [];
  const skipped = { running: 0, internal: 0, ignored: {} as Record<string, number> };
  const events: Event[] = [];
  const editedFilesByRun = new Map<string, Set<string>>();

  const base = (item: T3Item, type: Event['type'], actor: Event['actor'], ts: string, payload: Record<string, unknown>): Event => {
    const agent = item.run_id ? agents.get(item.run_id) ?? null : null;
    const native = nativeOf(item);
    return {
      id: `${session}:${item.turn_item_id}`,
      session_id: session,
      project_id: projectId,
      ts,
      seq: 0,
      actor,
      type,
      source: 't3_code',
      provenance: 'observed',
      recording_ref: null,
      media_offset_ms: null,
      tool_use_id: native.native_id,
      payload: {
        ...payload,
        agent,
        t3: { thread_id: thread.thread_id, run_id: item.run_id, turn_item_id: item.turn_item_id, item_type: item.type, item_status: item.status, driver: native.driver, native_id: native.native_id },
      },
    };
  };

  for (const item of snapshot.items) {
    const p = item.payload;
    if (item.status === 'running' || item.status === 'pending') {
      skipped.running += 1;
      continue;
    }
    if (item.type === 'user_message') {
      const createdBy = str(p.createdBy);
      const byAgent = createdBy !== 'user';
      events.push(
        base(item, 'prompt', byAgent ? 'agent' : 'developer', tsOf(item, 'start'), {
          prompt: typeof p.text === 'string' ? p.text : '',
          prompt_id: str(p.messageId),
          created_by: createdBy ?? 'unknown',
          creation_source: str(p.creationSource),
          input_intent: str(p.inputIntent),
          ...(byAgent ? { attribution: createdBy === 'agent' ? 'agent_authored' : 'unattributed' } : {}),
        }),
      );
      continue;
    }
    if (nativeOf(item).native_id === null) {
      // T3's own bookkeeping (workspace preparation and similar). Not provider or developer work.
      skipped.internal += 1;
      continue;
    }
    if (item.type === 'command_execution') {
      const command = typeof p.input === 'string' ? p.input : '';
      const output = typeof p.output === 'string' ? p.output : '';
      const exitCode = typeof p.exitCode === 'number' ? p.exitCode : null;
      if (isTestRun(command)) {
        let status = testStatusFromOutput(output);
        let signal: 'output_parse' | 'provider_status' = 'output_parse';
        const providerFailed = item.status === 'failed' || (exitCode != null && exitCode !== 0);
        if (status === 'unknown' && providerFailed) {
          status = 'failed';
          signal = 'provider_status';
        } else if (status === 'passed' && providerFailed) {
          // The output reads as a pass but the command failed (a coverage gate, a teardown error). Do not claim either.
          status = 'unknown';
          signal = 'provider_status';
        }
        events.push(base(item, 'test', 'tool', tsOf(item, 'end'), { status, command, output: clip(output, MAX_OUTPUT), signal, exit_code: exitCode }));
      } else {
        events.push(base(item, 'tool_call', 'agent', tsOf(item, 'start'), { tool_name: 'command', command, output: clip(output, MAX_TOOL_OUTPUT), exit_code: exitCode }));
      }
      continue;
    }
    if (item.type === 'file_change') {
      const file = str(p.fileName);
      const rel = file ? relativePath(file, root) : null;
      if (item.status !== 'completed' || !rel) {
        // The provider reported an edit attempt that did not apply. Keep it as a tool call, not an edit.
        events.push(base(item, 'tool_call', 'agent', tsOf(item, 'start'), { tool_name: 'file_change', title: str(p.title), files: rel ? [rel] : [], applied: false }));
        continue;
      }
      const { diff, format } = diffOf(p.diffStr, root);
      if (item.run_id) {
        const set = editedFilesByRun.get(item.run_id) ?? new Set<string>();
        set.add(rel);
        editedFilesByRun.set(item.run_id, set);
      }
      events.push(
        base(item, 'file_edit', 'agent', tsOf(item, 'end'), {
          files: [rel],
          ...(diff ? { diff } : {}),
          diff_format: format,
          tool_name: str(p.title) ?? 'file_change',
          additions: typeof p.additions === 'number' ? p.additions : null,
          deletions: typeof p.deletions === 'number' ? p.deletions : null,
        }),
      );
      continue;
    }
    if (TOOL_TYPES.has(item.type)) {
      events.push(base(item, 'tool_call', 'agent', tsOf(item, 'start'), { tool_name: str(p.toolName) ?? item.type, title: str(p.title) }));
      continue;
    }
    if (item.type === 'error' || item.type === 'run_interrupt_request' || item.type === 'run_interrupt_result') {
      events.push(base(item, 'tool_call', 'unknown', tsOf(item, 'start'), { tool_name: item.type, title: str(p.title) ?? str(p.message) }));
      continue;
    }
    skipped.ignored[item.type] = (skipped.ignored[item.type] ?? 0) + 1;
  }

  // T3 git checkpoints: what the checkout held after each run. Separate from what the provider reported.
  for (const checkpoint of useCheckpoints ? snapshot.checkpoints : []) {
    const files = Array.isArray(checkpoint.payload.files) ? checkpoint.payload.files.map(record) : [];
    const runId = checkpoint.run_id;
    const agent = runId ? agents.get(runId) ?? null : null;
    const checkpointEvent: Event = {
      id: `${session}:${checkpoint.checkpoint_id}`,
      session_id: session,
      project_id: projectId,
      ts: checkpoint.captured_at,
      seq: 0,
      actor: 'tool',
      type: 'checkpoint',
      source: 't3_code',
      provenance: 'observed',
      recording_ref: null,
      media_offset_ms: null,
      payload: {
        checkpoint_id: checkpoint.checkpoint_id,
        ref: str(checkpoint.payload.ref),
        parent_checkpoint_id: str(checkpoint.payload.parentCheckpointId),
        files: files.map((file) => ({ path: str(file.path), kind: str(file.kind), additions: file.additions ?? null, deletions: file.deletions ?? null })),
        status: checkpoint.status,
        agent,
        t3: { thread_id: thread.thread_id, run_id: runId },
      },
    };
    events.push(checkpointEvent);
    const edited = runId ? editedFilesByRun.get(runId) ?? new Set<string>() : new Set<string>();
    for (const file of files) {
      const changed = str(file.path);
      if (!changed || edited.has(changed)) continue;
      // Git saw this file change during the run, and no provider edit names it. Do not guess who changed it.
      events.push({
        ...checkpointEvent,
        id: `${session}:unattributed:${checkpoint.checkpoint_id}:${changed}`,
        actor: 'unknown',
        type: 'file_edit',
        provenance: 'inferred',
        payload: {
          files: [changed],
          attribution: 'unattributed',
          basis: 'The T3 git checkpoint lists this file as changed during the run. No provider edit in that run names it. A command, the developer, or another process may have changed it.',
          checkpoint_id: checkpoint.checkpoint_id,
          kind: str(file.kind),
          agent,
          t3: { thread_id: thread.thread_id, run_id: runId },
        },
      });
    }
  }

  // Runs: provider and model per run, and switches between consecutive runs.
  const captureRuns: CaptureRun[] = snapshot.runs.map((run) => {
    const prompt = snapshot.items.find((item) => item.type === 'user_message' && item.run_id === run.run_id);
    return { ...agents.get(run.run_id)!, requested_at: run.requested_at, completed_at: run.completed_at, prompt_by: prompt ? str(prompt.payload.createdBy) : null };
  });
  const switches: T3Capture['model_switches'] = [];
  for (let i = 1; i < captureRuns.length; i++) {
    const from = modelLabel(captureRuns[i - 1]);
    const to = modelLabel(captureRuns[i]);
    if (from !== to) switches.push({ at_run: captureRuns[i].run_ordinal, from, to });
  }

  for (const run of snapshot.runs) {
    if (run.status === 'rolled_back') unknowns.push(`Run ${run.ordinal} was rolled back in T3. Its edits were reverted in the checkout, but they stay on the line.`);
    else if (run.status === 'interrupted' || run.status === 'cancelled') unknowns.push(`Run ${run.ordinal} was ${run.status}. Work after the interruption was not captured.`);
    else if (run.status === 'failed') unknowns.push(`Run ${run.ordinal} ended with a provider failure.`);
    else if (run.status === 'running' || run.status === 'queued') unknowns.push(`Run ${run.ordinal} was still ${run.status} at import. Import again after it ends.`);
  }
  if (skipped.running > 0) unknowns.push(`${skipped.running} T3 items were still running at import and were left out.`);
  if (snapshot.migration !== CHECKED_MIGRATION) unknowns.push(`T3 database migration ${snapshot.migration ?? 'unknown'} differs from the checked version ${CHECKED_MIGRATION}. The mapping may be incomplete.`);
  if (agentsAuthored(events)) unknowns.push('Some prompts in this thread were written by an agent (T3 records createdBy=agent), not by the developer.');
  if (events.some((event) => event.payload.attribution === 'unattributed' && event.type === 'file_edit')) unknowns.push('Some files changed in a T3 checkpoint with no provider edit naming them. They are marked unattributed.');
  if (events.some((event) => event.type === 'file_edit' && event.payload.diff_format === 'not_exposed')) unknowns.push('For some edits the provider did not expose a diff to T3. The file name is known; the change text is not.');
  if (options.root) unknowns.push(`Paths are relative to ${path.basename(options.root)}, a folder named at import. It is not the T3 thread's own checkout.`);
  if (!useCheckpoints) unknowns.push('T3 git checkpoints were left out at import, because they belong to a different checkout. Unattributed changes cannot be detected.');
  unknowns.push('The model shown is the selection T3 recorded for each run. DevLens does not see which model the provider actually served.');
  unknowns.push('Test status comes from the command output (or the provider failure flag when the output is unclear). It is not a re-run.');

  const title = thread.title;
  return {
    events,
    capture: {
      adapter: ADAPTER,
      adapter_version: ADAPTER_VERSION,
      imported_at: (options.now ?? new Date()).toISOString(),
      label: `T3 Code thread, ${title}`,
      t3: {
        thread_id: thread.thread_id,
        title,
        project_id: thread.project_id,
        project_title: snapshot.project?.title ?? null,
        workspace: root ? path.basename(root) : null,
        branch: str(thread.payload.branch),
        worktree: worktree != null,
        migration: snapshot.migration,
        checked_migration: CHECKED_MIGRATION,
      },
      runs: captureRuns,
      model_switches: switches,
      unknowns,
      not_captured: ['agent reasoning and replies (T3 stores them; DevLens does not import them)', 'editor activity outside the agent', 'terminals outside T3', 'token usage and cost', 'camera', 'microphone'],
      skipped,
      recording: null,
      rerun: false,
    },
  };
}

function agentsAuthored(events: readonly Event[]): boolean {
  return events.some((event) => event.type === 'prompt' && event.actor !== 'developer');
}
