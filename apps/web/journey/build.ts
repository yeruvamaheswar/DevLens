// Pure: normalized DevLens events and edges in, a development journey out. No I/O, no model.
// It does not know which tool captured the events. Claude Code hooks and the T3 Code adapter both feed it.
// Every station stands for real event ids. A grouping or a label that rests on event order says so in `derived`.
import type { Edge, Event } from '../../../packages/core/event';

export type JourneyKind =
  | 'start'
  | 'prompt'
  | 'agent_prompt'
  | 'response'
  | 'actions'
  | 'edit'
  | 'unattributed'
  | 'test_failed'
  | 'test_passed'
  | 'test_unknown'
  | 'switch'
  | 'answer'
  | 'verified'
  | 'verify_failed';

export type AgentTag = { provider: string; model: string | null; basis: string };

export type JourneyStation = {
  id: string;
  kind: JourneyKind;
  title: string;
  detail: string;
  ts: string;
  offset_ms: number | null;
  event_ids: string[]; // the recorded events this station stands for
  context_ids: string[]; // tool calls between edits, and git checkpoints of the same run
  derived: string | null; // why a grouping or label is derived, in words
  agent: AgentTag | null;
  session: number;
  run: number | null;
  superseded: boolean;
  chain: boolean; // on the failure-to-fix chain
  branch: boolean; // off the session line: the separate re-run
};

export type ChainStep = { key: string; label: string; station: string | null; note: string };
export type JourneyQuestion = { id: string; rule_id: string; text: string; event_ids: string[]; answer?: { text: string; label: string } | null };

export type JourneySourceMeta = {
  key: string;
  label: string;
  adapter: 'claude_code_hook' | 't3_code';
  status: 'verified' | 'experimental';
  provenance_note: string;
  unknowns: string[];
  not_captured: string[];
  media: { url: string; label: string } | null;
  live?: boolean; // true while `t3 watch` stamped the capture in the last 15 s
  take?: {
    authorship: 'human' | 'scripted';
    authorship_note: string | null;
    analysis_status: 'complete' | 'partial' | 'missing' | 'failed';
    verification: 'rerun_passed' | 'rerun_failed' | 'none';
    sync: { basis: string; uncertainty_ms: number | null; anchors: number } | null; // null when there is no recording
    redaction: { spans: number; matches: number } | null;
  };
};

export type Journey = {
  source: JourneySourceMeta;
  stations: JourneyStation[];
  chain: ChainStep[];
  agents: { label: string; runs: number[] }[];
  sessions: number;
  span: { start: string | null; end: string | null };
  counts: Record<string, number>;
  questions: JourneyQuestion[];
  unknowns: string[];
};

type Ev = Event;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function statusOf(event: Ev): 'passed' | 'failed' | 'unknown' | null {
  const status = event.payload.status;
  return status === 'passed' || status === 'failed' || status === 'unknown' ? status : null;
}

function offsetOf(event: Ev): number | null {
  const value = event.media_offset_ms as number | string | null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function agentOf(event: Ev): AgentTag | null {
  const agent = event.payload.agent;
  if (!agent || typeof agent !== 'object') return null;
  const record = agent as Record<string, unknown>;
  const provider = text(record.provider);
  if (!provider) return null;
  return { provider, model: text(record.model) || null, basis: text(record.basis) || 'recorded with the event' };
}

function runOf(event: Ev): number | null {
  const agent = event.payload.agent as Record<string, unknown> | undefined;
  return agent && typeof agent.run_ordinal === 'number' ? agent.run_ordinal : null;
}

export function agentLabel(agent: AgentTag | null): string {
  return agent ? `${agent.provider} · ${agent.model ?? 'model unknown'}` : 'agent not recorded';
}

export function assertionOf(event: Ev): string | null {
  const output = text(event.payload.output);
  const named = output.match(/AssertionError \[ERR_ASSERTION\]: (.+)/)?.[1]?.trim();
  if (named) return named;
  const message = output.match(/^\s*(?:error|✖ [^\n]*\n\s*)?(?:Expected|expected)[^\n]{3,160}/m)?.[0]?.trim();
  return message || null;
}

function passCounts(event: Ev): string {
  const output = text(event.payload.output);
  const pass = output.match(/(?:ℹ|#)\s*pass (\d+)/)?.[1];
  const fail = output.match(/(?:ℹ|#)\s*fail (\d+)/)?.[1];
  if (pass != null && fail != null) return `pass ${pass}, fail ${fail}`;
  return statusOf(event) === 'passed' ? 'reported a pass' : statusOf(event) === 'failed' ? 'reported a fail' : 'status unknown';
}

function filesOf(event: Ev): string[] {
  const files = event.payload.files;
  return Array.isArray(files) ? files.map((file) => String(file)) : [];
}

function shortFile(file: string): string {
  const parts = file.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : file;
}

function shorten(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trim()}…`;
}

function isSandbox(event: Ev): boolean {
  return event.source === 'sandbox';
}

function isSessionTest(event: Ev): boolean {
  return event.type === 'test' && !isSandbox(event) && statusOf(event) != null;
}

function isUnattributed(event: Ev): boolean {
  return event.type === 'file_edit' && (event.actor === 'unknown' || event.payload.attribution === 'unattributed');
}

function toolName(event: Ev): string {
  const name = text(event.payload.tool_name) || text((event.payload.raw as Record<string, unknown> | undefined)?.tool_name);
  return name || 'tool';
}

// Claude Code hooks write a pre and a post event per tool use. Count one call per tool use id.
function uniqueCalls(events: readonly Ev[]): Ev[] {
  const seen = new Set<string>();
  const out: Ev[] = [];
  for (const event of events) {
    const key = event.tool_use_id || event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function actionsDetail(calls: readonly Ev[]): string {
  const names = new Map<string, number>();
  for (const call of calls) names.set(toolName(call), (names.get(toolName(call)) ?? 0) + 1);
  const parts = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return parts.join(', ');
}

export function buildJourney(input: { events: readonly Ev[]; edges: readonly Edge[]; source: JourneySourceMeta; questions?: JourneyQuestion[] }): Journey {
  const events = [...input.events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.seq - b.seq);
  const superseded = new Set(input.edges.filter((edge) => edge.rel === 'supersedes').map((edge) => edge.dst));
  const sessionIds: string[] = [];
  for (const event of events) if (!isSandbox(event) && !sessionIds.includes(event.session_id)) sessionIds.push(event.session_id);
  const sessionNo = (event: Ev) => Math.max(sessionIds.indexOf(event.session_id) + 1, 1);

  const stations: JourneyStation[] = [];
  const station = (partial: Omit<JourneyStation, 'chain' | 'branch' | 'superseded' | 'context_ids'> & Partial<Pick<JourneyStation, 'branch' | 'superseded' | 'context_ids'>>) => {
    stations.push({ chain: false, branch: false, superseded: false, context_ids: [], ...partial });
  };

  let calls: Ev[] = [];
  let edits: Ev[] = [];
  let between: Ev[] = []; // tool calls after the first edit of a segment
  let checkpoints: Ev[] = [];
  let lastSession: string | null = null;
  let lastAgent: string | null = null;
  let failedSincePrompt = false;
  const unattributedFiles = new Map<string, Set<string>>();
  const resultUses = new Set(events.filter((event) => (event.type === 'file_edit' || event.type === 'test') && event.tool_use_id).map((event) => event.tool_use_id as string));

  const flush = () => {
    if (calls.length > 0) {
      const unique = uniqueCalls(calls);
      const first = unique[0];
      station({
        id: `actions:${first.id}`,
        kind: 'actions',
        title: `${unique.length} agent ${unique.length === 1 ? 'action' : 'actions'}`,
        detail: actionsDetail(unique),
        ts: first.ts,
        offset_ms: offsetOf(first),
        event_ids: unique.map((event) => event.id),
        derived: `A group of ${unique.length} recorded tool ${unique.length === 1 ? 'call' : 'calls'} in a row, shown as one station.`,
        agent: agentOf(first),
        session: sessionNo(first),
        run: runOf(first),
      });
    }
    if (edits.length > 0) {
      const first = edits[0];
      const files = [...new Set(edits.flatMap(filesOf))];
      const betweenCalls = uniqueCalls(between);
      station({
        id: `edit:${first.id}`,
        kind: 'edit',
        title: edits.length === 1 ? 'code change' : `code change, ${edits.length} edits`,
        detail: files.map(shortFile).join(', ') || 'file unknown',
        ts: first.ts,
        offset_ms: offsetOf(first),
        event_ids: edits.map((event) => event.id),
        context_ids: [...betweenCalls.map((event) => event.id), ...checkpoints.map((event) => event.id)],
        derived: edits.length > 1 ? `${edits.length} recorded agent edits between the same two stations, shown as one station.` : null,
        agent: agentOf(first),
        session: sessionNo(first),
        run: runOf(first),
        superseded: edits.every((event) => superseded.has(event.id)),
      });
    }
    calls = [];
    if (edits.length > 0) checkpoints = [];
    edits = [];
    between = [];
  };

  for (const event of events) {
    if (isSandbox(event)) continue;
    if (event.session_id !== lastSession) {
      flush();
      station({
        id: `start:${event.id}`,
        kind: 'start',
        title: sessionIds.length > 1 ? `session ${sessionNo(event)} starts` : 'start',
        detail: event.source === 't3_code' ? 'T3 Code thread' : event.source === 'claude_code_hook' ? 'Claude Code session' : event.source,
        ts: event.ts,
        offset_ms: offsetOf(event),
        event_ids: [event.id],
        derived: 'The first recorded event of this session. Not a separate event.',
        agent: null,
        session: sessionNo(event),
        run: runOf(event),
      });
      lastSession = event.session_id;
    }
    if (event.type === 'checkpoint') {
      // Git snapshots attach to the code change of the same run. They are not stations.
      const host = [...stations].reverse().find((item) => item.kind === 'edit' && item.run === runOf(event));
      if (edits.length > 0 && runOf(edits[0]) === runOf(event)) checkpoints.push(event);
      else if (host) host.context_ids.push(event.id);
      continue;
    }
    if (event.type === 'prompt') {
      flush();
      checkpoints = [];
      const agent = agentOf(event);
      const label = agent ? agentLabel(agent) : null;
      if (label && lastAgent && label !== lastAgent) {
        station({
          id: `switch:${event.id}`,
          kind: 'switch',
          title: 'model switch',
          detail: `${lastAgent} → ${label}`,
          ts: event.ts,
          offset_ms: offsetOf(event),
          event_ids: [event.id],
          derived: 'The run this prompt starts has a different provider or model selection than the run before it, as recorded by the capture tool.',
          agent,
          session: sessionNo(event),
          run: runOf(event),
        });
      }
      if (label) lastAgent = label;
      const byDeveloper = event.actor === 'developer';
      const prompt = text(event.payload.prompt);
      station({
        id: event.id,
        kind: !byDeveloper ? 'agent_prompt' : failedSincePrompt ? 'response' : 'prompt',
        title: !byDeveloper ? 'agent-written prompt' : failedSincePrompt ? 'developer response' : 'developer prompt',
        detail: shorten(prompt, 34) || 'empty prompt',
        ts: event.ts,
        offset_ms: offsetOf(event),
        event_ids: [event.id],
        derived: !byDeveloper ? 'The capture tool records that an agent, not the developer, wrote this prompt.' : failedSincePrompt ? 'Called a response because it is the first developer prompt after a failed test, with no passing test in between, by event order. Not a claim about intent.' : null,
        agent,
        session: sessionNo(event),
        run: runOf(event),
      });
      if (byDeveloper) failedSincePrompt = false; // an agent-written prompt is not the developer's response
      continue;
    }
    if (event.type === 'answer') {
      flush();
      station({ id: event.id, kind: 'answer', title: 'developer answer', detail: shorten(text(event.payload.answer) || text(event.payload.text), 34), ts: event.ts, offset_ms: offsetOf(event), event_ids: [event.id], derived: null, agent: null, session: sessionNo(event), run: runOf(event) });
      continue;
    }
    if (isSessionTest(event)) {
      flush();
      const status = statusOf(event);
      if (status === 'failed') failedSincePrompt = true;
      if (status === 'passed') failedSincePrompt = false;
      station({
        id: event.id,
        kind: status === 'failed' ? 'test_failed' : status === 'passed' ? 'test_passed' : 'test_unknown',
        title: status === 'failed' ? 'test failed' : status === 'passed' ? 'test passed' : 'test, status unknown',
        detail: status === 'failed' ? shorten(assertionOf(event) ?? passCounts(event), 40) : passCounts(event),
        ts: event.ts,
        offset_ms: offsetOf(event),
        event_ids: [event.id],
        derived: event.payload.signal === 'provider_status' ? 'The output did not show a result, so the status comes from the provider failure flag.' : null,
        agent: agentOf(event),
        session: sessionNo(event),
        run: runOf(event),
      });
      continue;
    }
    if (event.type === 'file_edit') {
      if (isUnattributed(event)) {
        flush();
        const prev = stations[stations.length - 1];
        if (prev?.kind === 'unattributed' && prev.run === runOf(event)) {
          prev.event_ids.push(event.id);
          const set = unattributedFiles.get(prev.id) ?? new Set<string>();
          for (const file of filesOf(event)) set.add(shortFile(file));
          unattributedFiles.set(prev.id, set);
          const files = [...set];
          prev.title = `${prev.event_ids.length} unattributed changes`;
          prev.detail = files.length > 2 ? `${files.slice(0, 2).join(', ')} and ${files.length - 2} more` : files.join(', ');
          continue;
        }
        unattributedFiles.set(event.id, new Set(filesOf(event).map(shortFile)));
        station({
          id: event.id,
          kind: 'unattributed',
          title: 'unattributed change',
          detail: filesOf(event).map(shortFile).join(', ') || 'file unknown',
          ts: event.ts,
          offset_ms: offsetOf(event),
          event_ids: [event.id],
          derived: text(event.payload.basis) || 'No capture tool names who made this change.',
          agent: null,
          session: sessionNo(event),
          run: runOf(event),
        });
        continue;
      }
      if (edits.length === 0) flush(); // tool calls before the first edit become their own station
      edits.push(event);
      continue;
    }
    if (event.type === 'tool_call') {
      if (event.tool_use_id && resultUses.has(event.tool_use_id)) continue; // the hook's pre event of an edit or test
      if (edits.length > 0) between.push(event);
      else calls.push(event);
    }
  }
  flush();

  // The separate re-run hangs off the test it re-ran, as a branch.
  for (const rerun of events.filter((event) => isSandbox(event) && event.type === 'test')) {
    const status = statusOf(rerun);
    station({
      id: rerun.id,
      kind: status === 'passed' ? 'verified' : 'verify_failed',
      title: status === 'passed' ? 'independent re-run passed' : `independent re-run ${status ?? 'unknown'}`,
      detail: 'a separate worker, not the session',
      ts: rerun.ts,
      offset_ms: null,
      event_ids: [rerun.id],
      derived: null,
      agent: null,
      session: 0,
      run: null,
      branch: true,
    });
  }

  const chain = buildChain(stations, events);
  const onChain = new Set(chain.map((step) => step.station).filter((id): id is string => id != null));
  const firstIndex = stations.findIndex((item) => item.id === chain[0].station);
  const passStep = chain.find((step) => step.key === 'pass');
  const lastIndex = stations.findIndex((item) => item.id === passStep?.station);
  stations.forEach((item, index) => {
    item.chain = onChain.has(item.id) || (firstIndex >= 0 && lastIndex >= firstIndex && index >= firstIndex && index <= lastIndex && !item.branch);
  });

  const agents = new Map<string, Set<number>>();
  for (const event of events) {
    const agent = agentOf(event);
    if (!agent) continue;
    const set = agents.get(agentLabel(agent)) ?? new Set<number>();
    const run = runOf(event);
    if (run != null) set.add(run);
    agents.set(agentLabel(agent), set);
  }

  const sessionEvents = events.filter((event) => !isSandbox(event));
  const tests = sessionEvents.filter(isSessionTest);
  const counts: Record<string, number> = {
    prompts: sessionEvents.filter((event) => event.type === 'prompt').length,
    tool_calls: uniqueCalls(sessionEvents.filter((event) => event.type === 'tool_call')).length,
    edits: sessionEvents.filter((event) => event.type === 'file_edit' && !isUnattributed(event)).length,
    unattributed: sessionEvents.filter(isUnattributed).length,
    tests: tests.length,
    failed: tests.filter((event) => statusOf(event) === 'failed').length,
    passed: tests.filter((event) => statusOf(event) === 'passed').length,
    reruns: events.filter((event) => isSandbox(event) && event.type === 'test').length,
  };

  const unknowns = [...input.source.unknowns];
  if (!chain.find((step) => step.key === 'verification')?.station) unknowns.push('No independent re-run is recorded for the passing test.');
  if (counts.unattributed > 0) unknowns.push(`${counts.unattributed} changed ${counts.unattributed === 1 ? 'file is' : 'files are'} unattributed: no capture names who changed ${counts.unattributed === 1 ? 'it' : 'them'}.`);

  return {
    source: input.source,
    stations,
    chain,
    agents: [...agents.entries()].map(([label, runs]) => ({ label, runs: [...runs].sort((a, b) => a - b) })),
    sessions: sessionIds.length,
    span: { start: sessionEvents[0]?.ts ?? null, end: sessionEvents[sessionEvents.length - 1]?.ts ?? null },
    counts,
    questions: input.questions ?? journeyQuestions(stations, chain, events),
    unknowns,
  };
}

function after(stations: readonly JourneyStation[], from: JourneyStation | undefined, test: (item: JourneyStation) => boolean): JourneyStation | undefined {
  if (!from) return undefined;
  const start = stations.indexOf(from);
  return stations.slice(start + 1).find((item) => !item.branch && test(item));
}

// The failure-to-fix chain, step by step. A missing step is said in words, never filled in.
export function buildChain(stations: readonly JourneyStation[], events: readonly Ev[]): ChainStep[] {
  const step = (key: string, label: string, found: JourneyStation | undefined, missing: string, note?: string): ChainStep => ({ key, label, station: found?.id ?? null, note: found ? note ?? found.detail : missing });
  const failure = stations.find((item) => item.kind === 'test_failed');
  if (!failure) {
    const none = 'No failed test in this session, so there is no failure-to-fix chain.';
    return [
      step('failure', 'Original failure', undefined, 'No failed test in this session.'),
      ...(['first_fix', 'still_failing', 'response', 'revised_fix', 'pass', 'verification'] as const).map((key, index) =>
        step(key, ['First attempted fix', 'Still failing', 'Developer response', 'Revised code', 'Passing test', 'Independent verification'][index], undefined, none),
      ),
    ];
  }
  const at = (item: JourneyStation | undefined) => (item ? stations.indexOf(item) : Number.POSITIVE_INFINITY);
  const firstEdit = after(stations, failure, (item) => item.kind === 'edit');
  const earlyResponse = after(stations, failure, (item) => item.kind === 'response');

  let firstFix: JourneyStation | undefined;
  let stillFailing: JourneyStation | undefined;
  let response: JourneyStation | undefined;
  let revised: JourneyStation | undefined;
  let pass: JourneyStation | undefined;
  let notes: Record<string, string>;
  if (earlyResponse && at(earlyResponse) < at(firstEdit)) {
    // The developer answered the failure before any change was made: the first change is the revised code.
    response = earlyResponse;
    revised = after(stations, response, (item) => item.kind === 'edit');
    pass = after(stations, revised ?? response, (item) => item.kind === 'test_passed');
    notes = { first_fix: 'No change was attempted before the developer response.', still_failing: 'No change was attempted before the developer response.', revised_fix: 'No code change after the developer response.' };
  } else {
    firstFix = firstEdit;
    const nextTest = after(stations, firstFix, (item) => item.kind === 'test_failed' || item.kind === 'test_passed');
    stillFailing = nextTest?.kind === 'test_failed' ? nextTest : undefined;
    const firstPass = nextTest?.kind === 'test_passed' ? nextTest : undefined;
    const candidate = after(stations, stillFailing ?? failure, (item) => item.kind === 'response');
    response = candidate && at(candidate) < at(firstPass) ? candidate : undefined;
    revised = stillFailing ? after(stations, response ?? stillFailing, (item) => item.kind === 'edit') : undefined;
    pass = firstPass ?? after(stations, revised ?? firstFix ?? failure, (item) => item.kind === 'test_passed');
    notes = {
      first_fix: 'No code change after the failure.',
      still_failing: firstPass ? 'The first fix passed. No second failure.' : 'No test after the first fix.',
      revised_fix: stillFailing ? 'No code change after the second failure.' : 'Not needed: the first fix passed.',
    };
  }
  const passIds = new Set(stations.filter((item) => item.kind === 'test_passed' && pass && at(item) >= at(pass)).flatMap((item) => item.event_ids));
  const rerun = stations.find((item) => item.branch && item.kind === 'verified' && item.event_ids.some((id) => passIds.has(text(events.find((event) => event.id === id)?.payload.rerun_of))));
  const anyRerun = rerun ?? stations.find((item) => item.branch);
  return [
    step('failure', 'Original failure', failure, 'No failed test in this session.'),
    step('first_fix', 'First attempted fix', firstFix, notes.first_fix),
    step('still_failing', 'Still failing', stillFailing, notes.still_failing),
    step('response', 'Developer response', response, 'No developer prompt between the failure and the pass.'),
    step('revised_fix', 'Revised code', revised, notes.revised_fix),
    step('pass', 'Passing test', pass, 'No passing test after the fix.'),
    step('verification', 'Independent verification', rerun, anyRerun ? `A re-run exists but is not tied to this passing test (${anyRerun.title}).` : 'No independent re-run recorded.', rerun ? 'separate worker re-ran the test command' : undefined),
  ];
}

// Three interview questions from fixed rules over the chain. Each cites event ids. No model writes them.
export function journeyQuestions(stations: readonly JourneyStation[], chain: readonly ChainStep[], events: readonly Ev[]): JourneyQuestion[] {
  const at = (key: string) => stations.find((item) => item.id === chain.find((step) => step.key === key)?.station);
  const failure = at('failure');
  const stillFailing = at('still_failing');
  const response = at('response');
  const revised = at('revised_fix') ?? at('first_fix');
  const pass = at('pass');
  const verification = at('verification');
  const questions: JourneyQuestion[] = [];
  if (failure && stillFailing) {
    questions.push({
      id: 'jq-first-fix-still-failed',
      rule_id: 'rule-jq1-first-fix-still-failed-v1',
      text: `The first fix was followed by another failure (“${stillFailing.detail}”). What did that second failure tell you that the first one did not?`,
      event_ids: [...failure.event_ids, ...(at('first_fix')?.event_ids ?? []), ...stillFailing.event_ids],
    });
  } else if (failure) {
    questions.push({ id: 'jq-first-failure', rule_id: 'rule-jq1-first-failure-v1', text: `The first failing test said “${failure.detail}”. How did you decide where the cause was?`, event_ids: [...failure.event_ids] });
  }
  if (response) {
    const prompt = text(events.find((event) => event.id === response.event_ids[0])?.payload.prompt);
    questions.push({
      id: 'jq-response',
      rule_id: 'rule-jq2-response-after-failure-v1',
      text: `After the failure you wrote: “${shorten(prompt, 90)}”. Why did you point the agent there, and what would you have done if it had failed again?`,
      event_ids: [...response.event_ids],
    });
  }
  if (revised && pass) {
    const files = revised.detail;
    questions.push({
      id: 'jq-confirm-beyond-test',
      rule_id: 'rule-jq3-confirm-beyond-test-v1',
      text: `The passing change touched ${files}. ${verification ? 'A separate re-run also passed.' : 'No separate re-run is recorded.'} What else would you check before you trust this change in production?`,
      event_ids: [...revised.event_ids, ...pass.event_ids, ...(verification?.event_ids ?? [])],
    });
  }
  return questions.slice(0, 3);
}
