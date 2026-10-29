import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST, sessionLogFacts } from '../api/agent/route';
import { applyPost, readAgentState } from '../api/agent/state';
import { createAgentQueue, POLL_MS, POPUP_MS, type QueueItem } from './agent-queue';

// The pop-up and queue views moved to the widget (CR-8); apps/web/agent/widget.test.ts checks them.
// The /record agent row is checked in page.test.ts.

const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({ id, text: `Question ${id}?`, cites: ['e1'], reason: 'r', asked_at: '2026-01-01T00:00:00.000Z', answer: null, ...over });
const reply = (questions: QueueItem[], over: Record<string, unknown> = {}) => ({ available: true, enabled: true, session_id: 's1', questions, ...over });

function fakeServer(initial: unknown) {
  let state: unknown = initial;
  const posts: unknown[] = [];
  const fetcher = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(init.body ?? 'null')); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => state };
  });
  return { fetcher, posts, set: (next: unknown) => { state = next; } };
}

describe('question queue controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a new question as a pop-up for 10 seconds, then moves it to the queue', async () => {
    const server = fakeServer(reply([item('q1')]));
    const queue = createAgentQueue(server.fetcher);
    await queue.start();
    expect(queue.snapshot()).toMatchObject({ phase: 'on', popupId: null });
    expect(queue.snapshot().items.map((i) => i.id)).toEqual(['q1']);

    server.set(reply([item('q1'), item('q2')]));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(queue.snapshot().popupId).toBe('q2');
    expect(queue.snapshot().items.map((i) => i.id)).toEqual(['q1', 'q2']);

    await vi.advanceTimersByTimeAsync(POPUP_MS - 1);
    expect(queue.snapshot().popupId).toBe('q2');
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.snapshot().popupId).toBeNull();
    expect(queue.snapshot().items.map((i) => i.id)).toEqual(['q1', 'q2']);
    queue.stop();
  });

  it('polls every 5 seconds only while the opt-in is on', async () => {
    const server = fakeServer(reply([], { enabled: false }));
    const queue = createAgentQueue(server.fetcher);
    await queue.start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(server.fetcher).toHaveBeenCalledTimes(1);
    server.set(reply([]));
    await queue.setEnabled(true);
    const before = server.fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(server.fetcher.mock.calls.length - before).toBe(2);
    await queue.setEnabled(false);
    const after = server.fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(server.fetcher.mock.calls.length).toBe(after);
    expect(server.posts).toEqual([{ type: 'opt_in', enabled: true }, { type: 'opt_in', enabled: false }]);
    queue.stop();
  });

  it('sends an answer and a skip', async () => {
    const server = fakeServer(reply([item('q1'), item('q2')]));
    const queue = createAgentQueue(server.fetcher);
    await queue.start();
    await queue.answer('q1', 'because the test failed');
    await queue.skip('q2');
    expect(server.posts).toEqual([
      { type: 'answer', question_id: 'q1', action: 'answer', text: 'because the test failed' },
      { type: 'answer', question_id: 'q2', action: 'skip' },
    ]);
    server.set(reply([item('q1', { answer: { action: 'answer', text: 'x', answered_at: 't' } }), item('q2', { answer: { action: 'skip', text: '', answered_at: 't' } })]));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(queue.snapshot().items).toEqual([]);
    queue.stop();
  });

  it('reports unavailable and stops polling', async () => {
    const server = fakeServer({ available: false, enabled: false, session_id: null, questions: [] });
    const queue = createAgentQueue(server.fetcher, { keepPolling: true });
    await queue.start();
    expect(queue.snapshot()).toMatchObject({ phase: 'unavailable', items: [], offline: false });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(server.fetcher).toHaveBeenCalledTimes(1);
    queue.stop();
  });

  it('with keepPolling, keeps polling while off and sees the agent turn on', async () => {
    const server = fakeServer(reply([], { enabled: false, project: 'shop', event_count: 3, last_event_at: '2026-01-01T00:00:03.000Z' }));
    const queue = createAgentQueue(server.fetcher, { keepPolling: true });
    await queue.start();
    expect(queue.snapshot()).toMatchObject({ phase: 'off', log: { project: 'shop', eventCount: 3, lastEventAt: '2026-01-01T00:00:03.000Z' } });
    server.set(reply([], { enabled: false, project: 'shop', event_count: 5, last_event_at: null }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(queue.snapshot().log.eventCount).toBe(5);
    // Questions already open when the agent turns on go to the queue, not to a pop-up.
    server.set(reply([item('q1')]));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(queue.snapshot()).toMatchObject({ phase: 'on', popupId: null });
    expect(queue.snapshot().items.map((i) => i.id)).toEqual(['q1']);
    await queue.setEnabled(false);
    const after = server.fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(server.fetcher.mock.calls.length - after).toBe(2);
    queue.stop();
  });

  it('marks a failed fetch offline, retries every 5 seconds, and clears it on the next answer', async () => {
    let down = true;
    const fetcher = vi.fn(async () => {
      if (down) throw new Error('connection refused');
      return { ok: true, json: async () => reply([item('q1')]) };
    });
    const queue = createAgentQueue(fetcher);
    await queue.start();
    expect(queue.snapshot()).toMatchObject({ phase: 'loading', offline: true });
    expect(queue.snapshot().error).toMatch(/Retrying/);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    down = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(queue.snapshot()).toMatchObject({ phase: 'on', offline: false, error: null });
    queue.stop();
  });

  it('says how to fix a failed save', async () => {
    const fetcher = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => reply([item('q1')]) };
    });
    const queue = createAgentQueue(fetcher);
    await queue.start();
    await queue.answer('q1', 'x');
    expect(queue.snapshot().error).toMatch(/try Answer again/);
    await queue.setEnabled(false);
    expect(queue.snapshot().error).toMatch(/Check that DevLens is running/);
    queue.stop();
  });
});

function project(agent?: object, events: object[] = []): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-agent-route-'));
  mkdirSync(path.join(dir, '.devlens'));
  if (agent) writeFileSync(path.join(dir, '.devlens', 'agent.json'), JSON.stringify(agent));
  if (events.length > 0) writeFileSync(path.join(dir, '.devlens', 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return dir;
}
const ev = (id: string, session_id: string, type: string, payload: object = {}, extra: object = {}) => ({
  id, session_id, project_id: 'p', ts: '2026-01-01T00:00:00.000Z', seq: 1, actor: 'tool', type, source: type === 'question' || type === 'answer' ? 'devlens_question' : 'claude_code_hook',
  provenance: 'inferred', recording_ref: null, media_offset_ms: null, payload, ...extra,
});
const question = (session: string) => ev(`${session}:devlens_question:st1`, session, 'question', { text: 'Why?', cites: ['a'], reason: 'r' });

describe('agent route state', () => {
  it('writes nothing and reports unavailable when DEVLENS_PROJECT_DIR is unset', async () => {
    vi.stubEnv('DEVLENS_PROJECT_DIR', '');
    try {
      const got = await (await GET()).json();
      expect(got).toEqual({ available: false, enabled: false, session_id: null, questions: [], project: null, event_count: 0, last_event_at: null });
      const res = await POST(new Request('http://x/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'opt_in', enabled: true }) }));
      expect(res.status).toBe(503);
      expect(applyPost(null, { type: 'opt_in', enabled: true }).status).toBe(503);
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects a POST without a JSON content type', async () => {
    vi.stubEnv('DEVLENS_PROJECT_DIR', project());
    try {
      const res = await POST(new Request('http://x/api/agent', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }));
      expect(res.status).toBe(415);
    } finally { vi.unstubAllEnvs(); }
  });

  it('writes agent.json for the toggle and validates input', () => {
    const dir = project();
    expect(applyPost(dir, { type: 'opt_in', enabled: 'yes' }).status).toBe(400);
    expect(existsSync(path.join(dir, '.devlens', 'agent.json'))).toBe(false);
    expect(applyPost(dir, { type: 'opt_in', enabled: true }).status).toBe(200);
    expect(JSON.parse(readFileSync(path.join(dir, '.devlens', 'agent.json'), 'utf8'))).toEqual({ enabled: true });
    expect(readAgentState(dir).enabled).toBe(true);
    expect(applyPost(dir, { type: 'opt_in', enabled: false }).status).toBe(200);
    expect(readAgentState(dir)).toMatchObject({ available: true, enabled: false, questions: [] });
    for (const bad of [null, [], 'x', { type: 'nope' }, { type: 'opt_in', path: '/etc', enabled: 1 }]) expect(applyPost(dir, bad).status).toBe(400);
  });

  it('reads the latest session and appends one answer event per question', () => {
    const dir = project({ enabled: true }, [question('old'), ev('new:Stop:p1', 'new', 'stop', { hook_event_name: 'Stop' }), question('new')]);
    const state = readAgentState(dir);
    expect(state.session_id).toBe('new');
    expect(state.questions.map((q) => q.id)).toEqual(['new:devlens_question:st1']);

    const qid = 'new:devlens_question:st1';
    const now = new Date('2026-02-02T00:00:00.000Z');
    expect(applyPost(dir, { type: 'answer', question_id: qid, action: 'answer', text: '  ' }, {}, now).status).toBe(400);
    expect(applyPost(dir, { type: 'answer', question_id: 'nope', action: 'skip' }, {}, now).status).toBe(404);
    expect(applyPost(dir, { type: 'answer', question_id: qid, action: 'dance' }, {}, now).status).toBe(400);
    expect(applyPost(dir, { type: 'answer', question_id: qid, action: 'answer', text: 'x'.repeat(4001) }, {}, now).status).toBe(400);
    expect(applyPost(dir, { type: 'answer', question_id: qid, action: 'answer', text: 'my reason' }, {}, now).status).toBe(200);
    expect(applyPost(dir, { type: 'answer', question_id: qid, action: 'skip' }, {}, now).status).toBe(409);

    const lines = readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const answers = lines.filter((e) => e.type === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      id: `${qid}:answer`, session_id: 'new', actor: 'developer', type: 'answer', source: 'devlens_question', provenance: 'observed',
      recording_ref: null, media_offset_ms: null,
      payload: { question_id: qid, text: 'my reason', answered_at: now.toISOString(), delivery: 'live', actor: 'developer', action: 'answer' },
    });
    expect(readAgentState(dir).questions[0].answer).toMatchObject({ action: 'answer', text: 'my reason' });
  });

  it('records a skip with empty text, and post_session delivery after SessionEnd', () => {
    const dir = project({ enabled: true }, [question('s'), ev('s:SessionEnd:p', 's', 'stop', { hook_event_name: 'SessionEnd' })]);
    expect(applyPost(dir, { type: 'answer', question_id: 's:devlens_question:st1', action: 'skip', text: 'ignored' }).status).toBe(200);
    const last = readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    expect(last.payload).toMatchObject({ text: '', delivery: 'post_session', action: 'skip' });
  });

  it('writes no answer when the opt-in is off', () => {
    const dir = project({ enabled: false }, [question('s')]);
    expect(applyPost(dir, { type: 'answer', question_id: 's:devlens_question:st1', action: 'skip' }).status).toBe(409);
    expect(readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });
});

describe('agent route session log facts', () => {
  it('returns the project name and the latest session\'s event count, with the agent off', async () => {
    const dir = project({ enabled: false }, [
      ev('a1', 'old', 'prompt'), ev('a2', 'old', 'prompt'),
      ev('b1', 'new', 'prompt', {}, { ts: '2026-01-01T00:00:05.000Z' }), ev('b2', 'new', 'stop', {}, { ts: '2026-01-01T00:00:09.000Z' }),
    ]);
    appendTorn(dir);
    expect(sessionLogFacts(dir)).toEqual({ project: path.basename(dir), event_count: 2, last_event_at: '2026-01-01T00:00:09.000Z' });
    vi.stubEnv('DEVLENS_PROJECT_DIR', dir);
    try {
      const got = await (await GET()).json();
      // The agent fields keep their old meaning: off means no session and no questions.
      expect(got).toEqual({ available: true, enabled: false, session_id: null, questions: [], project: path.basename(dir), event_count: 2, last_event_at: '2026-01-01T00:00:09.000Z' });
    } finally { vi.unstubAllEnvs(); }
  });

  it('reports zero events for a project with no log yet, and nothing without a folder', () => {
    const dir = project();
    expect(sessionLogFacts(dir)).toEqual({ project: path.basename(dir), event_count: 0, last_event_at: null });
    expect(sessionLogFacts(null)).toEqual({ project: null, event_count: 0, last_event_at: null });
  });

  it('keeps the agent fields when the agent is on', async () => {
    const dir = project({ enabled: true }, [question('s')]);
    vi.stubEnv('DEVLENS_PROJECT_DIR', dir);
    try {
      const got = await (await GET()).json();
      expect(got).toMatchObject({ available: true, enabled: true, session_id: 's', event_count: 1 });
      expect(got.questions.map((q: { id: string }) => q.id)).toEqual(['s:devlens_question:st1']);
    } finally { vi.unstubAllEnvs(); }
  });
});

function appendTorn(dir: string) {
  writeFileSync(path.join(dir, '.devlens', 'events.jsonl'), `${readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8')}{"id":"torn`, 'utf8');
}
