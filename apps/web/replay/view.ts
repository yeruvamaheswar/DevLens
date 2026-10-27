import type { Edge, Event, Replay } from '../../../packages/core/event';
import { ANSWER_ABSENT, NOT_CAPTURED, reviewerQuestions, unknownLines, type ReviewerQuestion } from '../questions';
import { parseCommitDiffs, type CommitDiff } from './commits';

export const COMMIT_DIFF_LABEL = 'commit diff, from git, not from the hook log';

export type ClaimEvent = {
  id: string;
  type: string;
  source: string;
  status: string | null;
  offset_ms: number | null;
  output: string;
  summary: string;
  file: string | null;
  origin: string;
};

export type ClaimDiff = {
  name: string;
  label: string;
  patch: string;
  event_ids: string[];
  hook_redacted: boolean;
};

export type ClaimRule = {
  id: string;
  src: string;
  dst: string;
  rel: string;
  derived_by: string;
  provenance: Edge['provenance'];
  evidence_event_ids: string[];
};

export type Claim = {
  failure: ClaimEvent;
  answer_note: string;
  edits: ClaimEvent[];
  between: ClaimEvent[];
  pass: ClaimEvent;
  rerun: ClaimEvent;
  diffs: ClaimDiff[];
  rules: ClaimRule[];
  origins: { model: string; rule: string; worker: string };
};

export type ReplayView = Replay & {
  claim: Claim;
  questions: ReviewerQuestion[];
  unknowns: string[];
  not_captured: string[];
};

function byTime(a: Event, b: Event): number {
  const delta = Date.parse(a.ts) - Date.parse(b.ts);
  if (delta !== 0) return delta;
  return a.seq - b.seq;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function statusOf(event: Event): string | null {
  const status = event.payload.status;
  return status === 'passed' || status === 'failed' || status === 'unknown' ? status : null;
}

function offsetOf(event: Event): number | null {
  const value = event.media_offset_ms as number | string | null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function redactPaths(text: string): string {
  return text.replace(/\/Users\/[^\s:'")]+/g, '[path]').replace(/\/private\/var\/folders\/[^\s:'")]+/g, '[path]');
}

function displayFile(file: string): string {
  const at = file.lastIndexOf('/src/');
  if (at >= 0) return file.slice(at + 1);
  const parts = file.split('/');
  return parts.slice(-2).join('/');
}

function summaryOf(output: string, status: string | null, origin: string): string {
  const message = output.match(/AssertionError \[ERR_ASSERTION\]: (.+)/)?.[1]?.trim();
  if (message) return message;
  if (status === 'passed' && origin === 'worker re-run') return 'The worker re-run reports a pass.';
  if (status === 'failed' && origin === 'worker re-run') return 'The worker re-run reports a fail.';
  if (status === 'passed') return 'The session test line reports a pass.';
  if (status === 'failed') return 'The session test line reports a fail.';
  return status ?? 'recorded event';
}

function asClaimEvent(event: Event, origin: string): ClaimEvent {
  const output = redactPaths(textOf(event.payload.output));
  const status = statusOf(event);
  const files = Array.isArray(event.payload.files) ? event.payload.files.map((file) => displayFile(String(file))) : [];
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    status,
    offset_ms: offsetOf(event),
    output,
    summary: event.type === 'file_edit' ? 'Hook file edit.' : summaryOf(output, status, origin),
    file: files[0] ?? null,
    origin,
  };
}

function stripEvent(event: Event): Event {
  const payload: Record<string, unknown> = { ...event.payload };
  delete payload.raw;
  if (typeof payload.output === 'string') payload.output = redactPaths(payload.output);
  if (typeof payload.diff === 'string') payload.diff = redactPaths(payload.diff);
  if (typeof payload.prompt === 'string') payload.prompt = redactPaths(payload.prompt);
  if (Array.isArray(payload.files)) payload.files = payload.files.map((file) => displayFile(String(file)));
  return { ...event, payload };
}

function commitGroups(edits: readonly Event[], commits: readonly CommitDiff[]): ClaimDiff[] {
  const later = commits.filter((commit) => commit.name !== 'starter');
  const sessions: Event[][] = [];
  for (const edit of edits) {
    const last = sessions[sessions.length - 1];
    if (!last || last[0].session_id !== edit.session_id) sessions.push([edit]);
    else last.push(edit);
  }
  return sessions.map((group, index) => {
    const commit = later[Math.min(index, later.length - 1)];
    if (!commit) throw new Error('golden claim is incomplete');
    return {
      name: commit.name,
      label: COMMIT_DIFF_LABEL,
      patch: commit.patch,
      event_ids: group.map((event) => event.id),
      hook_redacted: group.some((event) => textOf(event.payload.diff).includes('[REDACTED]')),
    };
  });
}

function buildClaim(events: readonly Event[], edges: readonly Edge[], commits: readonly CommitDiff[]): Claim {
  const sessionTests = events.filter((event) => event.type === 'test' && event.source !== 'sandbox' && statusOf(event));
  const failure = sessionTests.find((event) => statusOf(event) === 'failed');
  const pass = [...sessionTests].reverse().find((event) => statusOf(event) === 'passed');
  if (!failure || !pass) throw new Error('golden claim is incomplete');
  const edits = events.filter((event) => event.type === 'file_edit' && byTime(failure, event) < 0 && byTime(event, pass) < 0);
  const between = sessionTests.filter((event) => event.id !== failure.id && event.id !== pass.id && byTime(failure, event) < 0 && byTime(event, pass) < 0);
  const rerun = events.find((event) => event.source === 'sandbox' && event.payload.signal === 'rerun' && event.payload.rerun_of === pass.id);
  if (!rerun) throw new Error('golden claim is incomplete');
  const rules = edges
    .filter((edge) => edge.rel === 'verifies' || edge.rel === 'supersedes' || edge.rel === 'failed')
    .map((edge) => ({
      id: edge.id,
      src: edge.src,
      dst: edge.dst,
      rel: edge.rel,
      derived_by: edge.derived_by,
      provenance: edge.provenance,
      evidence_event_ids: edge.evidence_event_ids,
    }));
  if (!rules.some((rule) => rule.rel === 'verifies' && rule.evidence_event_ids.includes(pass.id))) throw new Error('golden claim is incomplete');
  const developerAnswer = events.find((event) => event.type === 'answer');
  const answerText = textOf(developerAnswer?.payload.answer) || textOf(developerAnswer?.payload.text);
  return {
    failure: asClaimEvent(failure, 'session hook'),
    answer_note: developerAnswer && answerText ? answerText : ANSWER_ABSENT,
    edits: edits.map((event) => asClaimEvent(event, 'session hook')),
    between: between.map((event) => asClaimEvent(event, 'session hook')),
    pass: asClaimEvent(pass, 'session hook'),
    rerun: asClaimEvent(rerun, 'worker re-run'),
    diffs: commitGroups(edits, commits),
    rules,
    origins: {
      model: 'What the model said: not captured in this take.',
      rule: `What a rule derived: ${rules.map((rule) => `${rule.derived_by} (${rule.rel}, ${rule.provenance})`).join('; ')}.`,
      worker: `What the worker re-ran: ${statusOf(rerun) ?? 'unknown'}, separate from the session test line.`,
    },
  };
}

export function buildReplayView(replay: Replay, patch: string): ReplayView {
  const events = [...replay.events].sort(byTime);
  const commits = parseCommitDiffs(patch);
  return {
    ...replay,
    events: events.map(stripEvent),
    claim: buildClaim(events, replay.edges, commits),
    questions: reviewerQuestions(events, commits),
    unknowns: unknownLines(events, replay.edges, commits),
    not_captured: [...NOT_CAPTURED],
  };
}
