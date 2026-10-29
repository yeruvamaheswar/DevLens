import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentQueue, POLL_MS, POPUP_MS, type QueueItem, type QueueSnapshot } from '../record/agent-queue';
import { createRecruiterNotices, NOTICE_MS } from './recruiter-feed';
import { createPanelBridge, panelHandler, pillText, widgetMode, WidgetView, type PanelMessage, type WidgetActions, type WidgetMode } from './widget';

const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({ id, text: `Question ${id}?`, cites: ['e1'], reason: 'r', asked_at: '2026-01-01T00:00:00.000Z', answer: null, ...over });
const reply = (questions: QueueItem[], over: Record<string, unknown> = {}) => ({ available: true, enabled: true, session_id: 's1', questions, project: 'p', event_count: 1, last_event_at: null, ...over });
const snapOf = (over: Partial<QueueSnapshot>): QueueSnapshot => ({ phase: 'on', items: [], popupId: null, error: null, offline: false, log: { project: 'p', eventCount: 0, lastEventAt: null }, ...over });
const noop: WidgetActions = { open: () => {}, collapse: () => {}, later: () => {}, answer: () => {}, skip: () => {} };
const view = (mode: WidgetMode, snap: QueueSnapshot, notice: string | null = null) => renderToStaticMarkup(createElement(WidgetView, { mode, snap, notice, actions: noop }));

function fakeServer(initial: unknown) {
  let state: unknown = initial;
  let down = false;
  const posts: unknown[] = [];
  const fetcher = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (down) throw new Error('connection refused');
    if (init?.method === 'POST') { posts.push(JSON.parse(init.body ?? 'null')); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => state };
  });
  return { fetcher, posts, set: (next: unknown) => { state = next; }, down: (value: boolean) => { down = value; } };
}

// What the live widget does on each change: pick the mode, measure, report. Sizes stand in for the DOM.
const SIZE: Record<WidgetMode, [number, number]> = { hidden: [0, 0], pill: [220, 38], popup: [360, 190], queue: [360, 420] };
function driveWidget(queue: ReturnType<typeof createAgentQueue>, expanded = () => false) {
  const posted: PanelMessage[] = [];
  const report = createPanelBridge(() => ({ postMessage: (m) => posted.push(m) }));
  const modes: WidgetMode[] = [];
  const step = (snap: QueueSnapshot) => {
    const mode = widgetMode(snap, expanded(), null);
    modes.push(mode);
    report(mode, ...SIZE[mode]);
  };
  queue.subscribe(step);
  return { posted, modes, pill: () => pillText(queue.snapshot()) };
}

describe('widget modes (EVAL-26)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('pops up a new question for 10 seconds, then returns to the pill with the open count', async () => {
    const server = fakeServer(reply([item('q1')]));
    const queue = createAgentQueue(server.fetcher, { keepPolling: true });
    const w = driveWidget(queue);
    await queue.start();
    expect(w.pill()).toBe('DevLens · 1 question');

    server.set(reply([item('q1'), item('q2')]));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(widgetMode(queue.snapshot(), false, null)).toBe('popup');
    await vi.advanceTimersByTimeAsync(POPUP_MS - 1);
    expect(widgetMode(queue.snapshot(), false, null)).toBe('popup');
    await vi.advanceTimersByTimeAsync(1);
    expect(widgetMode(queue.snapshot(), false, null)).toBe('pill');
    expect(w.pill()).toBe('DevLens · 2 questions');

    // One DEC-19 message per mode change, none for the repeated polls in between.
    expect(w.posted).toEqual([
      { type: 'mode', mode: 'pill', width: 220, height: 38 },
      { type: 'mode', mode: 'popup', width: 360, height: 190 },
      { type: 'mode', mode: 'pill', width: 220, height: 38 },
    ]);
    expect(w.modes.length).toBeGreaterThan(w.posted.length);
    queue.stop();
  });

  it('answer and skip lower the count, and an empty queue reads watching', async () => {
    const server = fakeServer(reply([item('q1'), item('q2')]));
    const queue = createAgentQueue(server.fetcher, { keepPolling: true });
    const w = driveWidget(queue);
    await queue.start();
    expect(w.pill()).toBe('DevLens · 2 questions');
    server.set(reply([item('q1', { answer: { action: 'answer', text: 'x', answered_at: 't' } }), item('q2')]));
    await queue.answer('q1', 'because the retry test failed');
    expect(w.pill()).toBe('DevLens · 1 question');
    server.set(reply([item('q1', { answer: { action: 'answer', text: 'x', answered_at: 't' } }), item('q2', { answer: { action: 'skip', text: '', answered_at: 't' } })]));
    await queue.skip('q2');
    expect(w.pill()).toBe('DevLens · watching');
    expect(server.posts).toEqual([
      { type: 'answer', question_id: 'q1', action: 'answer', text: 'because the retry test failed' },
      { type: 'answer', question_id: 'q2', action: 'skip' },
    ]);
    queue.stop();
  });

  it('a failed fetch reads offline, and the agent off hides the widget', async () => {
    const server = fakeServer(reply([]));
    const queue = createAgentQueue(server.fetcher, { keepPolling: true });
    const w = driveWidget(queue);
    await queue.start();
    expect(w.pill()).toBe('DevLens · watching');
    server.down(true);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(widgetMode(queue.snapshot(), false, null)).toBe('pill');
    expect(w.pill()).toBe('DevLens · offline');
    server.down(false);
    server.set(reply([], { enabled: false }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(widgetMode(queue.snapshot(), false, null)).toBe('hidden');
    expect(w.posted.at(-1)).toEqual({ type: 'mode', mode: 'hidden', width: 0, height: 0 });
    // Still polling while off, so turning the agent on in /record shows the pill again.
    server.set(reply([]));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(widgetMode(queue.snapshot(), false, null)).toBe('pill');
    queue.stop();
  });

  it('the pill click opens the queue; the queue wins over a pop-up', () => {
    const snap = snapOf({ items: [item('q1'), item('q2')], popupId: 'q2' });
    expect(widgetMode(snap, false, null)).toBe('popup');
    expect(widgetMode(snap, true, null)).toBe('queue');
    expect(widgetMode(snapOf({ phase: 'unavailable' }), false, null)).toBe('hidden');
    expect(widgetMode(snapOf({ phase: 'loading' }), false, null)).toBe('hidden');
    expect(widgetMode(snapOf({ phase: 'off' }), false, 'Sent update to recruiter')).toBe('pill');
    expect(widgetMode(snapOf({ offline: true }), false, null)).toBe('pill');
    expect(widgetMode(snapOf({ offline: true }), true, null)).toBe('queue');
  });
});

describe('panel bridge (DEC-19)', () => {
  afterEach(() => { delete (globalThis as { webkit?: unknown }).webkit; });

  it('does nothing in a normal browser', () => {
    expect(panelHandler()).toBeNull();
    const report = createPanelBridge();
    expect(() => report('pill', 220, 38)).not.toThrow();
  });

  it('posts to the webkit handler once per mode or size change', () => {
    const got: PanelMessage[] = [];
    (globalThis as { webkit?: unknown }).webkit = { messageHandlers: { devlens: { postMessage: (m: PanelMessage) => got.push(m) } } };
    const report = createPanelBridge();
    report('pill', 220, 38);
    report('pill', 220, 38);
    report('pill', 240, 56); // a notice line made the pill taller
    report('queue', 360, 300);
    expect(got).toEqual([
      { type: 'mode', mode: 'pill', width: 220, height: 38 },
      { type: 'mode', mode: 'pill', width: 240, height: 56 },
      { type: 'mode', mode: 'queue', width: 360, height: 300 },
    ]);
  });
});

describe('widget view', () => {
  it('pill: a word plus a mark for each state; only a live agent is clickable', () => {
    const watching = view('pill', snapOf({}));
    expect(watching).toContain('DevLens · watching');
    expect(watching).toMatch(/<button type="button" class="widget-pill" aria-expanded="false"/);
    expect(watching).toContain('wmark-ring');
    const waiting = view('pill', snapOf({ items: [item('a'), item('b')] }));
    expect(waiting).toContain('DevLens · 2 questions');
    expect(waiting).toContain('wmark-square');
    const offline = view('pill', snapOf({ offline: true }));
    expect(offline).toContain('DevLens · offline');
    expect(offline).toContain('wmark-dashed');
    expect(offline).not.toContain('<button');
  });

  it('pop-up: a polite live region with the question, Answer and Later, and no autofocus', () => {
    const html = view('popup', snapOf({ items: [item('q1'), item('q2')], popupId: 'q2' }));
    expect(html).toMatch(/<p class="sr-only" role="status" aria-live="polite">New question: Question q2\?<\/p>/);
    expect(html).toContain('<p class="widget-q">Question q2?</p>');
    expect(html).toContain('>Answer</button>');
    expect(html).toContain('>Later</button>');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('autofocus');
  });

  it('queue: each question with a labeled textarea, Answer, and Skip, plus Collapse', () => {
    const html = view('queue', snapOf({ items: [item('q1'), item('q2')] }));
    expect(html.match(/<textarea/g)).toHaveLength(2);
    expect(html).toMatch(/<label for="widget-answer-q1"[^>]*>Your answer<\/label>/);
    expect(html.match(/>Answer<\/button>/g)).toHaveLength(2);
    expect(html.match(/>Skip<\/button>/g)).toHaveLength(2);
    expect(html).toMatch(/<button type="button" class="widget-collapse" aria-expanded="true">Collapse<\/button>/);
    expect(html).not.toContain('autofocus');
    expect(view('queue', snapOf({}))).toContain('No questions waiting.');
    expect(view('queue', snapOf({ items: [item('q1')], error: 'Could not save the answer.' }))).toContain('role="alert"');
  });

  it('hidden paints nothing but keeps the live region', () => {
    const html = view('hidden', snapOf({ phase: 'off' }));
    expect(html).toBe('<div class="widget" data-mode="hidden"><p class="sr-only" role="status" aria-live="polite"></p></div>');
  });

  it('shows a recruiter notice as a short line in the pill and the pop-up', () => {
    expect(view('pill', snapOf({}), 'Sent update to recruiter')).toMatch(/class="widget-notice">.*Sent update to recruiter<\/p>/);
    expect(view('popup', snapOf({ items: [item('q1')], popupId: 'q1' }), 'Recruiter asked for status · sent')).toContain('Recruiter asked for status · sent');
    expect(view('pill', snapOf({ phase: 'off' }), 'Sent update to recruiter')).toContain('DevLens · agent off');
  });

  it('never shows a score, rank, or verdict', () => {
    const all = [view('pill', snapOf({})), view('queue', snapOf({ items: [item('q1')] })), view('popup', snapOf({ items: [item('q1')], popupId: 'q1' }))].join('');
    expect(all).not.toMatch(/score|rank|verdict/i);
  });
});

describe('recruiter notices (DEC-25)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const entry = (id: string, kind: 'update' | 'status') => ({ id, kind, ts: 't', since: 't', lines: [] });

  it('ignores entries from the first load, then shows each new one for 5 seconds', async () => {
    let updates = [entry('u1', 'update')];
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ sharing: true, project: 'p', updates }) }));
    const feed = createRecruiterNotices(fetcher);
    await feed.start();
    expect(feed.notice()).toBeNull();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.notice()).toBeNull();

    updates = [...updates, entry('u2', 'update')];
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.notice()).toBe('Sent update to recruiter');
    await vi.advanceTimersByTimeAsync(NOTICE_MS - 1);
    expect(feed.notice()).toBe('Sent update to recruiter');
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.notice()).toBeNull();

    updates = [...updates, entry('s1', 'status')];
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.notice()).toBe('Recruiter asked for status · sent');
    feed.stop();
  });

  it('shows nothing when the route is missing or fails', async () => {
    for (const fetcher of [
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
      vi.fn(async () => { throw new Error('down'); }),
    ]) {
      const feed = createRecruiterNotices(fetcher);
      await feed.start();
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(feed.notice()).toBeNull();
      feed.stop();
    }
  });
});
