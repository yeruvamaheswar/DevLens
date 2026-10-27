import { describe, expect, it } from 'vitest';
import { askChoices } from '../src/ask';
import { DEFAULT_LIVE_CONFIG, startLive, step } from '../src/live';
import type { AskState, Catalog, Category, ChoiceQuestion, DetectedChoice, LiveInput, LiveState, TrackedQuestion } from '../src/types';

const categories: Category[] = ['ui_framework', 'meta_framework', 'python_web_framework', 'node_web_framework', 'database', 'orm', 'test_framework', 'state_management'];
const catalog: Catalog = {
  version: 'test',
  categories: Object.fromEntries(categories.map((c) => [c, c.replace(/_/g, ' ')])) as Catalog['categories'],
  options: categories.map((category, i) => ({ id: `opt${i}`, name: `Option ${i}`, category, packages: { npm: [`pkg${i}`] } })),
};
const START = 1_700_000_000_000;
const min = (n: number) => START + n * 60_000;
const SESSION = 's1';

function makeQuestions(count: number): ChoiceQuestion[] {
  const choices: DetectedChoice[] = categories.slice(0, count).map((category, i) => ({
    option_id: `opt${i}`, option_name: `Option ${i}`, category, category_label: category.replace(/_/g, ' '),
    package: `pkg${i}`, field: 'dependencies', manifest_path: 'package.json', evidence_event_ids: [`e${i}`],
  }));
  const state: AskState = { session_id: SESSION, asked_option_ids: [], asked_categories: [] };
  return askChoices(state, choices, catalog).questions;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
const qid = (i: number) => `${SESSION}:choice:opt${i}`;
const stop = (m: number): LiveInput => ({ kind: 'stop', at_ms: min(m), event_id: `stop${m}` });
const feed = (state: LiveState, count: number, at = 0) => step(state, { kind: 'questions', questions: makeQuestions(count), at_ms: min(at) }).state;
const status = (state: LiveState, i: number) => state.questions.find((q) => q.question.id === qid(i))?.status;
const get = (state: LiveState, id: string): TrackedQuestion => state.questions.find((q) => q.question.id === id)!;

describe('live slot', () => {
  it('asks nothing before the 3 minute warm-up, then asks at the next Stop', () => {
    const s = feed(startLive(SESSION, START), 2);
    expect(step(s, stop(1)).ask).toBeNull();
    expect(step(s, stop(2.9)).ask).toBeNull();
    const asked = step(s, stop(3));
    expect(asked.ask?.question.id).toBe(qid(0));
    expect(asked.state.questions[0]).toMatchObject({ status: 'asked', asked_at_ms: min(3) });
    expect(asked.state.live_asked_at_ms).toEqual([min(3)]);
  });

  it('never has two open asks', () => {
    let s = feed(startLive(SESSION, START), 3);
    s = step(s, stop(4)).state;
    for (const m of [10, 20, 40]) {
      const r = step(s, stop(m));
      expect(r.ask).toBeNull();
      s = r.state;
    }
    expect(s.questions.filter((q) => q.status === 'asked')).toHaveLength(1);
  });

  it('enforces the 5 minute cooldown after an answer', () => {
    let s = feed(startLive(SESSION, START), 3);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'answer', question_id: qid(0), text: 'because', at_ms: min(4.5) }).state;
    expect(step(s, stop(8)).ask).toBeNull();
    expect(step(s, stop(9)).ask?.question.id).toBe(qid(1));
  });

  it('allows at most 3 live asks in any 30 minute window over a long stream', () => {
    let s = feed(startLive(SESSION, START), 8);
    const asks: number[] = [];
    for (let m = 1; m <= 120; m++) {
      const r = step(s, stop(m));
      s = r.state;
      if (r.ask) {
        asks.push(m);
        s = step(s, { kind: 'control', action: 'skip', question_id: r.ask.question.id, at_ms: min(m) }).state;
      }
    }
    expect(asks.length).toBeGreaterThan(3);
    for (const t of asks) expect(asks.filter((a) => a >= t && a < t + 30).length).toBeLessThanOrEqual(3);
  });

  it('suppresses the 6th question once 5 are tracked', () => {
    const s = feed(startLive(SESSION, START), 6);
    expect(s.questions.map((q) => q.status)).toEqual(['queued', 'queued', 'queued', 'queued', 'queued', 'suppressed']);
    expect(step(s, stop(4)).ask?.question.id).toBe(qid(0));
  });

  it('skips an id that is already tracked', () => {
    const s = feed(feed(startLive(SESSION, START), 2), 2);
    expect(s.questions).toHaveLength(2);
  });
});

describe('answers and controls', () => {
  it('records a live answer with delivery live', () => {
    let s = feed(startLive(SESSION, START), 1);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'answer', question_id: qid(0), text: 'It was fast.', at_ms: min(5) }).state;
    const q = get(s, qid(0));
    expect(q.status).toBe('answered');
    expect(q.answer).toMatchObject({ delivery: 'live', text: 'It was fast.', actor: 'developer', answered_at: new Date(min(5)).toISOString() });
  });

  it('not_now defers, and a later answer has delivery post_session', () => {
    let s = feed(startLive(SESSION, START), 1);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'control', action: 'not_now', question_id: qid(0), at_ms: min(5) }).state;
    expect(status(s, 0)).toBe('deferred');
    s = step(s, { kind: 'answer', question_id: qid(0), text: 'later', at_ms: min(50) }).state;
    expect(get(s, qid(0)).answer?.delivery).toBe('post_session');
  });

  it('skip marks skipped', () => {
    let s = feed(startLive(SESSION, START), 1);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'control', action: 'skip', question_id: qid(0), at_ms: min(5) }).state;
    expect(status(s, 0)).toBe('skipped');
  });

  it('not_now and skip on a question that is not open throw', () => {
    const s = feed(startLive(SESSION, START), 1);
    expect(() => step(s, { kind: 'control', action: 'skip', question_id: qid(0), at_ms: min(5) })).toThrow(qid(0));
    expect(() => step(s, { kind: 'control', action: 'not_now', question_id: 'nope', at_ms: min(5) })).toThrow('nope');
  });

  it('mute moves queued to post_session and stops live asks', () => {
    let s = feed(startLive(SESSION, START), 3);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'control', action: 'mute', question_id: null, at_ms: min(5) }).state;
    expect(s.muted).toBe(true);
    expect(s.questions.map((q) => q.status)).toEqual(['asked', 'post_session', 'post_session']);
    s = step(s, { kind: 'answer', question_id: qid(0), text: 'x', at_ms: min(6) }).state;
    expect(step(s, stop(60)).ask).toBeNull();
    s = step(s, { kind: 'answer', question_id: qid(1), text: 'y', at_ms: min(61) }).state;
    expect(get(s, qid(1)).answer?.delivery).toBe('post_session');
  });

  it('answering an unknown id or a non-answerable status throws', () => {
    const s = feed(startLive(SESSION, START), 1);
    expect(() => step(s, { kind: 'answer', question_id: 'ghost', text: 'x', at_ms: min(5) })).toThrow('ghost');
    expect(() => step(s, { kind: 'answer', question_id: qid(0), text: 'x', at_ms: min(5) })).toThrow(qid(0));
  });
});

describe('session end and report close', () => {
  it('session_end moves queued and asked to post_session; report_close expires unanswered', () => {
    let s = feed(startLive(SESSION, START), 4);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'answer', question_id: qid(0), text: 'done', at_ms: min(5) }).state;
    s = step(s, stop(10)).state; // opt1 open
    s = step(s, { kind: 'control', action: 'not_now', question_id: qid(1), at_ms: min(11) }).state;
    s = step(s, stop(16)).state; // opt2 open
    s = step(s, { kind: 'session_end', at_ms: min(20) }).state;
    expect(s.questions.map((q) => q.status)).toEqual(['answered', 'deferred', 'post_session', 'post_session']);
    s = step(s, { kind: 'report_close', at_ms: min(30) }).state;
    expect(s.questions.map((q) => q.status)).toEqual(['answered', 'expired', 'expired', 'expired']);
  });
});

describe('follow-up', () => {
  const diff = (m: number, line: string): LiveInput => ({ kind: 'diff', files: [{ file: 'src/store.ts', added: [line] }], event_ids: [`d${m}`], at_ms: min(m) });

  function answered(): LiveState {
    let s = feed(startLive(SESSION, START), 1);
    s = step(s, stop(4)).state;
    return step(s, { kind: 'answer', question_id: qid(0), text: 'I wanted `useReducer` for the state.', at_ms: min(5) }).state;
  }

  it('queues one follow-up when an answer term appears in a later diff, not again, and never for a follow-up', () => {
    let s = step(answered(), diff(6, 'const x = unrelated();')).state;
    expect(s.questions).toHaveLength(1);
    s = step(s, diff(7, 'const [a, b] = useReducer(r, i);')).state;
    expect(s.questions).toHaveLength(2);
    const follow = s.questions[1];
    expect(follow).toMatchObject({ status: 'queued', follow_up_id: null });
    expect(follow.question.id).toBe(`${qid(0)}:follow`);
    expect(get(s, qid(0)).follow_up_id).toBe(follow.question.id);
    s = step(s, diff(8, 'useReducer again')).state;
    expect(s.questions).toHaveLength(2);
    // answer the follow-up with a term, then diff again: still no follow-up of a follow-up
    s = step(s, stop(12)).state;
    s = step(s, { kind: 'answer', question_id: follow.question.id, text: 'I checked `useReducer` and `dispatch()`', at_ms: min(13) }).state;
    s = step(s, diff(14, 'dispatch(); useReducer')).state;
    expect(s.questions).toHaveLength(2);
  });

  it('suppresses a follow-up when the session total is reached', () => {
    let s = feed(startLive(SESSION, START), 5);
    s = step(s, stop(4)).state;
    s = step(s, { kind: 'answer', question_id: qid(0), text: '`useReducer`', at_ms: min(5) }).state;
    s = step(s, diff(6, 'useReducer')).state;
    expect(s.questions).toHaveLength(6);
    expect(s.questions[5].status).toBe('suppressed');
  });
});

describe('silence and purity', () => {
  it('E5: Stops and diffs with no questions yield zero asks', () => {
    let s = startLive(SESSION, START);
    for (let m = 0; m < 60; m++) {
      const a = step(s, stop(m));
      const b = step(a.state, { kind: 'diff', files: [{ file: 'a.ts', added: ['useReducer'] }], event_ids: ['d'], at_ms: min(m) });
      expect(a.ask).toBeNull();
      expect(b.ask).toBeNull();
      s = b.state;
    }
    expect(s.questions).toEqual([]);
    expect(s.live_asked_at_ms).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const questions = makeQuestions(3);
    const inputs: LiveInput[] = [
      { kind: 'questions', questions, at_ms: min(0) }, stop(4),
      { kind: 'answer', question_id: qid(0), text: 'uses `useReducer`', at_ms: min(5) },
      { kind: 'diff', files: [{ file: 'a.ts', added: ['useReducer'] }], event_ids: ['d'], at_ms: min(6) },
      { kind: 'control', action: 'mute', question_id: null, at_ms: min(7) },
      { kind: 'session_end', at_ms: min(8) }, { kind: 'report_close', at_ms: min(9) },
    ];
    let s = startLive(SESSION, START);
    for (const input of inputs) s = step(deepFreeze(s), deepFreeze(input)).state; // a write to frozen data throws
    const frozen = JSON.stringify(s);
    step(deepFreeze(s), stop(100));
    expect(JSON.stringify(s)).toBe(frozen);
    expect(DEFAULT_LIVE_CONFIG).toEqual({ warmup_ms: 180_000, cooldown_ms: 300_000, window_ms: 1_800_000, max_live_per_window: 3, max_per_session: 5 });
  });
});

describe('after session_end and report_close (c2-review finding 1)', () => {
  const diff = (m: number): LiveInput => ({ kind: 'diff', files: [{ file: 'src/store.ts', added: ['const s = useReducer(r, {});'] }], event_ids: [`d${m}`], at_ms: min(m) });
  it('a follow-up made after session_end waits for the report and is never asked live', () => {
    let s = step(feed(startLive(SESSION, START), 1), stop(3)).state;
    s = step(s, { kind: 'answer', question_id: qid(0), text: 'I used `useReducer`', at_ms: min(4) }).state;
    s = step(s, { kind: 'session_end', at_ms: min(5) }).state;
    s = step(s, diff(6)).state;
    expect(get(s, `${qid(0)}:follow`).status).toBe('post_session');
    expect(step(s, stop(60)).ask).toBeNull();
    s = step(s, { kind: 'report_close', at_ms: min(61) }).state;
    expect(get(s, `${qid(0)}:follow`).status).toBe('expired');
    expect(step(s, stop(120)).ask).toBeNull();
  });
  it('questions delivered after session_end are post_session, and after report_close are expired', () => {
    let s = step(startLive(SESSION, START), { kind: 'session_end', at_ms: min(1) }).state;
    s = feed(s, 1, 2);
    expect(status(s, 0)).toBe('post_session');
    expect(step(s, stop(10)).ask).toBeNull();
    s = step(s, { kind: 'report_close', at_ms: min(11) }).state;
    expect(status(s, 0)).toBe('expired');
    s = feed(step(startLive(SESSION, START), { kind: 'report_close', at_ms: min(1) }).state, 1, 2);
    expect(status(s, 0)).toBe('expired');
    expect(step(s, { kind: 'session_end', at_ms: min(3) }).state.phase).toBe('closed');
  });
});
