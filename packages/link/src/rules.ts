import type { Edge, Event, LinkRule } from '../../core/event';

// Pure rules. No I/O and no model calls.
// Hook test events have no files and no patch_event_id. Rule 5 uses the command
// and the file_edit events between a failure and a later pass.
// An edit with no hooked event stays actor "unknown" and payload.attribution "unattributed".

export const RULE_PROMPTED = 'rule-1-prompted-v1';
export const RULE_EDITED = 'rule-2-edited-v1';
export const RULE_RAN_TEST = 'rule-3-ran-test-v1';
export const RULE_FAILED = 'rule-4-failed-v1';
export const RULE_LATER_PASS = 'rule-5-later-pass-v1';

const TEST_COMMAND = /(^|[\s/])(npm test|vitest|pytest)([\s]|$)/;
const TOOL_TYPES = new Set<Event['type']>(['tool_call', 'file_edit', 'test']);

export function isUnattributedEdit(event: Event): boolean {
  return event.type === 'file_edit' && event.actor === 'unknown' && event.payload.attribution === 'unattributed';
}

function orderEvents(events: readonly Event[]): Event[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.ts.localeCompare(b.event.ts) || a.event.seq - b.event.seq || a.index - b.index)
    .map((item) => item.event);
}

function commandOf(event: Event): string | null {
  const command = event.payload.command;
  return typeof command === 'string' && command.length > 0 ? command : null;
}

function statusOf(event: Event): 'passed' | 'failed' | 'unknown' | null {
  if (event.type !== 'test') return null;
  const status = event.payload.status;
  if (status === 'passed' || status === 'failed' || status === 'unknown') return status;
  return null;
}

function filesOf(event: Event): string[] {
  const files = event.payload.files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is string => typeof file === 'string' && file.length > 0);
}

function toolUseId(event: Event): string | null {
  return typeof event.tool_use_id === 'string' && event.tool_use_id.length > 0 ? event.tool_use_id : null;
}

function isSessionTest(event: Event): boolean {
  return event.type === 'test' && event.source !== 'sandbox' && statusOf(event) !== null && isTestCommand(commandOf(event) ?? '');
}

function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

function cite(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function makeEdge(ruleId: string, src: string, dst: string, rel: Edge['rel'], provenance: Edge['provenance'], evidence: readonly string[]): Edge {
  return { id: `${ruleId}:${src}:${dst}`, src, dst, rel, derived_by: ruleId, provenance, evidence_event_ids: cite(evidence) };
}

function enclosingPrompt(events: readonly Event[], index: number): Event | null {
  for (let i = index - 1; i >= 0; i--) {
    if (events[i].type === 'stop') return null;
    if (events[i].type === 'prompt') return events[i];
  }
  return null;
}

function sameSpan(events: readonly Event[], left: number, right: number): boolean {
  const a = enclosingPrompt(events, left);
  const b = enclosingPrompt(events, right);
  return a !== null && b !== null && a.id === b.id;
}

function pairedCall(events: readonly Event[], edit: Event, index: number): Event | null {
  const id = toolUseId(edit);
  if (!id) return null;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = events[i];
    if (candidate.type === 'tool_call' && toolUseId(candidate) === id) return candidate;
  }
  return null;
}

function nearestEdit(events: readonly Event[], index: number): Event | null {
  const test = events[index];
  const testFiles = filesOf(test);
  for (let i = index - 1; i >= 0; i--) {
    const candidate = events[i];
    if (candidate.type !== 'file_edit' || isUnattributedEdit(candidate)) continue;
    const overlap = testFiles.length > 0 && filesOf(candidate).some((file) => testFiles.includes(file));
    if (sameSpan(events, i, index) || overlap) return candidate;
  }
  return null;
}

function confirmingRerun(events: readonly Event[], rerunOf: string, status: 'passed' | 'failed', command: string): boolean {
  return events.some((event) => {
    if (event.type !== 'test' || event.source !== 'sandbox') return false;
    return event.payload.signal === 'rerun'
      && event.payload.rerun_of === rerunOf
      && event.payload.status === status
      && event.payload.command === command;
  });
}

export const rulePrompted: LinkRule = (input) => {
  const events = orderEvents(input);
  const edges: Edge[] = [];
  let prompt: Event | null = null;
  for (const event of events) {
    if (event.type === 'prompt') {
      prompt = event;
      continue;
    }
    if (event.type === 'stop') {
      prompt = null;
      continue;
    }
    if (!prompt || event.source === 'sandbox' || isUnattributedEdit(event) || !TOOL_TYPES.has(event.type)) continue;
    edges.push(makeEdge(RULE_PROMPTED, prompt.id, event.id, 'prompted', 'observed', [prompt.id, event.id]));
  }
  return edges;
};

export const ruleEdited: LinkRule = (input) => {
  const events = orderEvents(input);
  const edges: Edge[] = [];
  for (let i = 0; i < events.length; i++) {
    const edit = events[i];
    if (edit.type !== 'file_edit' || isUnattributedEdit(edit) || filesOf(edit).length === 0) continue;
    const pair = pairedCall(events, edit, i) ?? enclosingPrompt(events, i);
    if (!pair) continue;
    const provenance = edit.provenance === 'observed' ? 'observed' : 'inferred';
    edges.push(makeEdge(RULE_EDITED, edit.id, pair.id, 'edited', provenance, [pair.id, edit.id]));
  }
  return edges;
};

export const ruleRanTest: LinkRule = (input) => {
  const events = orderEvents(input);
  const edges: Edge[] = [];
  for (let i = 0; i < events.length; i++) {
    const test = events[i];
    if (!isSessionTest(test)) continue;
    const edit = nearestEdit(events, i);
    if (!edit) continue;
    const provenance = sameSpan(events, events.indexOf(edit), i) ? 'observed' : 'inferred';
    edges.push(makeEdge(RULE_RAN_TEST, test.id, edit.id, 'ran_test', provenance, [edit.id, test.id]));
  }
  return edges;
};

export const ruleFailed: LinkRule = (input) => {
  const events = orderEvents(input);
  const edges: Edge[] = [];
  for (let i = 0; i < events.length; i++) {
    const test = events[i];
    if (!isSessionTest(test) || statusOf(test) !== 'failed') continue;
    const command = commandOf(test);
    const edit = nearestEdit(events, i);
    if (!command || !edit) continue;
    const provenance = confirmingRerun(events, test.id, 'failed', command) ? 'observed' : 'inferred';
    edges.push(makeEdge(RULE_FAILED, test.id, edit.id, 'failed', provenance, [edit.id, test.id]));
  }
  return edges;
};

export const ruleLaterPass: LinkRule = (input) => {
  const events = orderEvents(input);
  const edges: Edge[] = [];
  const open = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!isSessionTest(event)) continue;
    const command = commandOf(event);
    const status = statusOf(event);
    if (!command || !status) continue;
    if (status === 'unknown') continue;
    if (status === 'failed') {
      if (!open.has(command)) open.set(command, i);
      continue;
    }
    const start = open.get(command);
    if (start === undefined) continue;
    open.delete(command);
    const failure = events[start];
    const between = events.slice(start + 1, i);
    const edits = between.filter((item) => item.type === 'file_edit');
    const middle = between
      .filter((item) => item.type === 'file_edit' || (statusOf(item) === 'failed' && commandOf(item) === command))
      .map((item) => item.id);
    const evidence = cite([failure.id, ...middle, event.id]);
    const provenance = confirmingRerun(events, event.id, 'passed', command) ? 'observed' : 'inferred';
    // No edit between the failure and the pass: nothing was fixed, so nothing is verified.
    if (edits.length === 0) continue;
    const last = edits[edits.length - 1];
    edges.push(makeEdge(RULE_LATER_PASS, event.id, last.id, 'verifies', provenance, evidence));
    for (const earlier of edits.slice(0, -1)) {
      edges.push(makeEdge(RULE_LATER_PASS, last.id, earlier.id, 'supersedes', provenance, [failure.id, earlier.id, last.id, event.id]));
    }
  }
  return edges;
};

export const linkRules: readonly LinkRule[] = [rulePrompted, ruleEdited, ruleRanTest, ruleFailed, ruleLaterPass];

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((k) => record[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Collapse byte-identical deliveries of one id. A different payload under the same id is an error.
export function dedupeEvents(events: readonly Event[]): Event[] {
  const seen = new Map<string, { event: Event; key: string }>();
  const out: Event[] = [];
  for (const event of events) {
    const key = stable(event);
    const prior = seen.get(event.id);
    if (!prior) {
      seen.set(event.id, { event, key });
      out.push(event);
    } else if (prior.key !== key) {
      throw new Error(`Event id "${event.id}" appears twice with different content`);
    }
  }
  return out;
}

export function linkEvents(input: readonly Event[]): Edge[] {
  const events = dedupeEvents(input);
  const sessions = new Map<string, Event[]>();
  for (const event of events) {
    const group = sessions.get(event.session_id) ?? [];
    group.push(event);
    sessions.set(event.session_id, group);
  }
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const group of sessions.values()) {
    for (const rule of linkRules) {
      for (const edge of rule(group)) {
        if (edge.src === edge.dst || seen.has(edge.id)) continue;
        seen.add(edge.id);
        edges.push(edge);
      }
    }
  }
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return edges;
}
