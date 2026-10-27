import type { Edge, Event } from '../../packages/core/event';

export const ANSWER_ABSENT = 'No developer answer was captured in this take.';
export const NOT_CAPTURED = ['reasoning', 'the editor', 'other terminals', 'camera', 'microphone'] as const;

export type ReviewerQuestion = {
  id: string;
  rule_id: string;
  text: string;
  event_ids: string[];
};

function byTime(a: Event, b: Event): number {
  const delta = Date.parse(a.ts) - Date.parse(b.ts);
  if (delta !== 0) return delta;
  return a.seq - b.seq;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function statusOf(event: Event): 'passed' | 'failed' | 'unknown' | null {
  const status = event.payload.status;
  return status === 'passed' || status === 'failed' || status === 'unknown' ? status : null;
}

function assertionMessage(output: string): string | null {
  const named = output.match(/AssertionError \[ERR_ASSERTION\]: (.+)/);
  return named?.[1]?.trim() || null;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function omittedErrorQuestion(events: readonly Event[]): ReviewerQuestion | null {
  const prompts = events.filter((event) => event.type === 'prompt');
  const failures = events.filter((event) => event.type === 'test' && event.source !== 'sandbox' && statusOf(event) === 'failed');
  const ids: string[] = [];
  let promptId = '';
  for (const failure of failures) {
    const message = assertionMessage(textOf(failure.payload.output));
    if (!message) continue;
    const next = prompts.find((prompt) => byTime(failure, prompt) < 0);
    if (!next || textOf(next.payload.prompt).includes(message)) continue;
    if (!promptId) promptId = next.id;
    if (next.id !== promptId) continue;
    ids.push(failure.id);
  }
  if (!promptId || ids.length === 0) return null;
  return {
    id: 'q-next-prompt-omits-error',
    rule_id: 'rule-q1-next-prompt-omits-error-v1',
    text: 'The test failed, and the next prompt did not mention the error. Was that deliberate?',
    event_ids: [...ids, promptId],
  };
}

function untestedEditQuestion(events: readonly Event[]): ReviewerQuestion | null {
  const ids: string[] = [];
  const sessions = new Map<string, Event[]>();
  for (const event of events) {
    const group = sessions.get(event.session_id) ?? [];
    group.push(event);
    sessions.set(event.session_id, group);
  }
  for (const group of sessions.values()) {
    const edits = group.filter((event) => event.type === 'file_edit' && event.actor === 'agent');
    const tests = group.filter((event) => event.type === 'test' && event.source !== 'sandbox');
    if (edits.length === 0 || tests.length === 0) continue;
    const lastTest = tests[tests.length - 1];
    const kept = edits.filter((edit) => {
      const nextTest = tests.find((test) => byTime(edit, test) < 0);
      const nextEdit = edits.find((other) => byTime(edit, other) < 0);
      return nextTest?.id === lastTest.id && nextEdit != null && byTime(nextEdit, nextTest) < 0;
    });
    if (kept.length === 0) continue;
    for (const edit of edits) {
      if (byTime(edit, lastTest) < 0 && kept.some((item) => byTime(item, edit) <= 0)) ids.push(edit.id);
    }
    ids.push(lastTest.id);
  }
  if (ids.length === 0) return null;
  return {
    id: 'q-edit-untested-until-end',
    rule_id: 'rule-q2-edit-untested-until-end-v1',
    text: 'Was an agent edit kept with no test until the end? The cited events show the edits and the last test.',
    event_ids: ids,
  };
}

function unhookedCommitQuestion(events: readonly Event[], commits: readonly { name: string }[]): ReviewerQuestion | null {
  const names = commits.map((commit) => commit.name).filter((name) => name !== 'starter');
  const edits = events.filter((event) => event.type === 'file_edit');
  if (names.length === 0 || edits.length === 0 || events.some((event) => event.source === 'git')) return null;
  return {
    id: 'q-unhooked-commit',
    rule_id: 'rule-q3-unhooked-commit-v1',
    text: `Who made the ${joinNames(names)} ${names.length === 1 ? 'commit' : 'commits'}? Git shows ${names.length === 1 ? 'it' : 'them'}, but no hooked event does. The cited ids are the hooked edits in the sessions, not the commits.`,
    event_ids: edits.map((event) => event.id),
  };
}

export function reviewerQuestions(events: readonly Event[], commits: readonly { name: string }[]): ReviewerQuestion[] {
  const ordered = [...events].sort(byTime);
  const questions: ReviewerQuestion[] = [];
  const omitted = omittedErrorQuestion(ordered);
  const kept = untestedEditQuestion(ordered);
  const unhooked = unhookedCommitQuestion(ordered, commits);
  if (omitted) questions.push(omitted);
  if (kept) questions.push(kept);
  if (unhooked) questions.push(unhooked);
  return questions.slice(0, 5);
}

export function unknownLines(events: readonly Event[], edges: readonly Edge[], commits: readonly { name: string }[]): string[] {
  const unattributed = events.filter((event) => event.type === 'file_edit' && event.actor === 'unknown' && event.payload.attribution === 'unattributed');
  const commitNames = commits.map((commit) => commit.name).filter((name) => name !== 'starter');
  const inferred = edges.filter((edge) => edge.provenance === 'inferred');
  const outside = events.filter((event) => event.source !== 'sandbox' && event.media_offset_ms == null);
  const unattributedLine = unattributed.length > 0
    ? `Unattributed changes: ${unattributed.length} file edit ${unattributed.length === 1 ? 'event has' : 'events have'} no hooked actor (${unattributed.map((event) => event.id).join(', ')}).`
    : commitNames.length > 0
      ? `Unattributed changes: no file-edit event is unattributed. The ${joinNames(commitNames)} commits have no hooked event.`
      : 'Unattributed changes: none recorded in this take.';
  const inferredLine = inferred.length > 0
    ? `Inferred edges: ${inferred.map((edge) => `${edge.derived_by} (${edge.rel})`).join(', ')}. An inferred link is not a cause.`
    : 'Inferred edges: none in this take. An inferred link is not a cause.';
  const footageLine = outside.length > 0
    ? `Footage with no matching event: ${outside.length} take ${outside.length === 1 ? 'event has' : 'events have'} no media offset. The picture is not a claim.`
    : 'Footage with no matching event: every take event has a media offset. The worker re-run has no footage. The picture is not a claim.';
  return [
    unattributedLine,
    inferredLine,
    'A passing test may not be a meaningful test.',
    'Model and token data were not read for this take.',
    'Nothing here predicts job performance.',
    footageLine,
    ANSWER_ABSENT,
  ];
}
