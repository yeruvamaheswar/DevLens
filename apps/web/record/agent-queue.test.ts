import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../api/agent/route';
import { applyPost, readAgentState } from '../api/agent/state';
import { AgentPanelView, createAgentQueue, POLL_MS, POPUP_MS, type AgentActions, type QueueItem, type QueueSnapshot } from './agent-queue';

// Recorder render from before the toggle was added (captured from page.tsx at commit 97139d1, phase idle).
const RECORDER_BEFORE = `<header class="topbar"><a class="skip" href="#main">Skip to content</a><a class="wm" href="/" aria-label="DevLens home"><svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true"><path class="wm-line" d="M4 9H20L26 3"></path><circle class="wm-start" cx="4" cy="9" r="3.5"></circle><circle class="wm-end" cx="27" cy="3" r="3"></circle></svg>DevLens</a><nav aria-label="Main"><a href="/replay">Replay</a><a href="/record" aria-current="page">Record</a><span class="nav-later" title="The scenario catalog is not built yet">Scenarios <small>later</small></span></nav></header><main id="main" class="page record"><h1>Record</h1><section class="rec-panel" aria-label="Recorder"><p class="rec-state" data-phase="idle"><svg class="rec-line" width="64" height="20" viewBox="0 0 64 20" aria-hidden="true"><path class="rec-run" d="M2 10H44"></path><circle class="rec-stop" cx="52" cy="10" r="6"></circle></svg>Not recording</p><p role="status" class="rec-message">Nothing is recorded until you click Record one window or Record my desktop (second opt-in).</p><div class="rec-actions"><button type="button" class="btn btn--primary">Record one window</button><button type="button" class="btn" aria-describedby="desktop-consent">Record my desktop (second opt-in)</button></div><p class="note">Read what is <a href="#consent">captured and not captured</a> before you start.</p></section><section id="consent" aria-label="Consent" class="consent"><div><h2>Captured</h2><ul><li>The chosen window</li><li>Prompts, tool calls, diffs, and output</li><li>Test results</li><li>The typed answer</li></ul></div><div><h2>Not captured</h2><ul><li>Camera</li><li>Microphone</li><li>The whole desktop, unless you choose Record my desktop (second opt-in)</li><li>A score</li></ul></div></section><section id="desktop-consent" aria-label="Desktop consent" class="desktop-consent"><h2>Desktop opt-in</h2><p>Record my desktop is a separate choice. A monitor take can show other windows and notifications. Audio and camera stay off. You can delete the take before upload.</p></section></main>`;

const noop: AgentActions = { setEnabled: () => {}, answer: () => {}, skip: () => {}, dismissPopup: () => {} };

describe('/record with the opt-in off', () => {
  it('renders today\'s Recorder plus the toggle and nothing else', () => {
    // tsx (not vitest) loads page.tsx, because tsconfig sets jsx to preserve and vitest cannot parse JSX.
    const code = `import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.React = React;
const { Recorder } = await import(process.argv[1]);
const snap = { phase: 'idle', message: 'Nothing is recorded until you click Record one window or Record my desktop (second opt-in).', objectUrl: null, wallStartMs: null, wallEndMs: null, pauses: [], mode: 'window', displaySurface: null };
const session = { snapshot: () => snap, subscribe: () => () => {}, dispose: () => {} };
process.stdout.write(renderToStaticMarkup(React.createElement(Recorder, { session })));
`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, path.resolve('apps/web/record/page.tsx')], { encoding: 'utf8', cwd: path.resolve('.') });
    expect(result.status, result.stderr).toBe(0);
    const html = result.stdout;
    const start = html.indexOf('<section class="agent-panel"');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('</section>', start) + '</section>'.length;
    const panel = html.slice(start, end);
    expect(panel.match(/<button/g)).toHaveLength(1);
    expect(panel).toContain('aria-pressed="false"');
    expect(panel).not.toMatch(/agent-popup|agent-queue|<textarea|aria-live/);
    expect(html.slice(0, start) + html.slice(end)).toBe(RECORDER_BEFORE);
  });
});

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
    const shown = renderToStaticMarkup(createElement(AgentPanelView, { snap: queue.snapshot(), actions: noop }));
    expect(shown).toContain('aria-live="polite"');
    expect(shown).toContain('Question q2?');
    expect(shown).toContain('Question queue (1)');

    await vi.advanceTimersByTimeAsync(POPUP_MS - 1);
    expect(queue.snapshot().popupId).toBe('q2');
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.snapshot().popupId).toBeNull();
    const moved = renderToStaticMarkup(createElement(AgentPanelView, { snap: queue.snapshot(), actions: noop }));
    expect(moved).toContain('Question queue (2)');
    expect(moved).not.toContain('New question');
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

  it('reports unavailable and renders only a disabled toggle', async () => {
    const queue = createAgentQueue(fakeServer({ available: false, enabled: false, session_id: null, questions: [] }).fetcher);
    await queue.start();
    const snap: QueueSnapshot = queue.snapshot();
    expect(snap.phase).toBe('unavailable');
    const html = renderToStaticMarkup(createElement(AgentPanelView, { snap, actions: noop }));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('disabled');
    queue.stop();
  });

  it('renders labeled controls for answer and skip', () => {
    const snap: QueueSnapshot = { phase: 'on', items: [item('q1')], popupId: null, error: null };
    const html = renderToStaticMarkup(createElement(AgentPanelView, { snap, actions: noop }));
    expect(html).toContain('>Answer</button>');
    expect(html).toContain('>Skip</button>');
    expect(html).toMatch(/<label for="agent-answer-q1"[^>]*>Your answer<\/label>/);
    expect(html).not.toContain('autofocus');
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
      expect(got).toEqual({ available: false, enabled: false, session_id: null, questions: [] });
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
