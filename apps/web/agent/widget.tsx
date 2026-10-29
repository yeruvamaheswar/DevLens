'use client';
// Written with createElement, not JSX: tsconfig sets jsx to preserve, so vitest cannot parse JSX in a test import.
// The bottom-right DevLens Agent widget (CR-8). A native panel hosts this page; only the widget paints.
import { createElement as h, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createAgentQueue, useAgentQueue, type QueueItem, type QueueSnapshot } from '../record/agent-queue';
import { createRecruiterNotices, noticeText, type NoticeFeed } from './recruiter-feed';

export type WidgetMode = 'hidden' | 'pill' | 'popup' | 'queue';
export type PanelMessage = { type: 'mode'; mode: WidgetMode; width: number; height: number };
type PanelHandler = { postMessage: (message: PanelMessage) => void };

// Offline wins (except over an open queue), then off (hidden unless a recruiter notice must show), then the open queue, the pop-up, the pill.
export function widgetMode(snap: QueueSnapshot, expanded: boolean, notice: string | null): WidgetMode {
  // An open queue stays open while offline, so a half-typed answer is not lost.
  if (snap.offline) return expanded ? 'queue' : 'pill';
  if (snap.phase !== 'on') return notice ? 'pill' : 'hidden';
  if (expanded) return 'queue';
  if (snap.popupId !== null && snap.items.some((item) => item.id === snap.popupId)) return 'popup';
  return 'pill';
}

export function pillText(snap: QueueSnapshot): string {
  if (snap.offline) return 'DevLens · offline';
  if (snap.phase !== 'on') return 'DevLens · agent off';
  const n = snap.items.length;
  if (n === 0) return 'DevLens · watching';
  return `DevLens · ${n} ${n === 1 ? 'question' : 'questions'}`;
}

// The DEC-19 bridge. In a normal browser there is no webkit handler, so it posts nothing.
export function panelHandler(): PanelHandler | null {
  const scope = globalThis as { webkit?: { messageHandlers?: { devlens?: PanelHandler } } };
  return scope.webkit?.messageHandlers?.devlens ?? null;
}

// Returns a reporter that posts one message per change of mode or size, and nothing for a repeat.
export function createPanelBridge(handler: () => PanelHandler | null = panelHandler) {
  let last = '';
  return (mode: WidgetMode, width: number, height: number): boolean => {
    const key = `${mode} ${width} ${height}`;
    if (key === last) return false;
    last = key;
    handler()?.postMessage({ type: 'mode', mode, width, height });
    return true;
  };
}

export type WidgetActions = {
  open: (focusId?: string) => void;
  collapse: () => void;
  later: () => void;
  answer: (id: string, text: string) => void;
  skip: (id: string) => void;
};

type MarkKind = 'watching' | 'waiting' | 'offline' | 'off' | 'notice';

// Every state is a word plus a mark shape. Shapes follow the station marks in DESIGN.md.
function Mark({ kind }: { kind: MarkKind }) {
  const shape: Record<MarkKind, ReactNode> = {
    watching: h('circle', { className: 'wmark-ring', cx: 7, cy: 7, r: 4.5 }),
    waiting: h('rect', { className: 'wmark-square', x: 2, y: 2, width: 10, height: 10 }),
    offline: h('circle', { className: 'wmark-dashed', cx: 7, cy: 7, r: 4.5 }),
    off: h('circle', { className: 'wmark-off', cx: 7, cy: 7, r: 4.5 }),
    notice: h('path', { className: 'wmark-diamond', d: 'M7 1.5L12.5 7L7 12.5L1.5 7Z' }),
  };
  return h('svg', { className: 'wmark', width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true }, shape[kind]);
}

function markFor(snap: QueueSnapshot): MarkKind {
  if (snap.offline) return 'offline';
  if (snap.phase !== 'on') return 'off';
  return snap.items.length > 0 ? 'waiting' : 'watching';
}

function Notice({ text }: { text: string | null }) {
  return text ? h('p', { className: 'widget-notice' }, h(Mark, { kind: 'notice' }), text) : null;
}

function Row({ item, actions }: { item: QueueItem; actions: WidgetActions }) {
  const [draft, setDraft] = useState('');
  const field = `widget-answer-${item.id}`;
  return h('li', { className: 'widget-item' },
    h('p', { className: 'widget-q' }, item.text),
    h('label', { htmlFor: field, className: 'widget-label' }, 'Your answer'),
    h('textarea', { id: field, className: 'widget-field', rows: 3, maxLength: 4000, value: draft, onChange: (e: { target: { value: string } }) => setDraft(e.target.value) }),
    h('div', { className: 'widget-actions' },
      h('button', { type: 'button', className: 'btn btn--primary', disabled: draft.trim().length === 0, onClick: () => actions.answer(item.id, draft) }, 'Answer'),
      h('button', { type: 'button', className: 'btn', onClick: () => actions.skip(item.id) }, 'Skip')));
}

function Pill({ snap, notice, actions }: { snap: QueueSnapshot; notice: string | null; actions: WidgetActions }) {
  const inner = [
    h('span', { key: 'word', className: 'widget-word' }, h(Mark, { kind: markFor(snap) }), pillText(snap)),
    h(Notice, { key: 'notice', text: notice }),
  ];
  // Only a live agent opens the queue. Offline or off, the pill is a status line.
  if (snap.phase === 'on' && !snap.offline) {
    return h('button', { type: 'button', className: 'widget-pill', 'aria-expanded': false, 'aria-label': `${pillText(snap)}. Open the questions.`, onClick: () => actions.open() }, inner);
  }
  return h('div', { className: 'widget-pill widget-pill--static' }, inner);
}

function Popup({ snap, notice, actions }: { snap: QueueSnapshot; notice: string | null; actions: WidgetActions }) {
  const item = snap.items.find((q) => q.id === snap.popupId);
  if (!item) return null;
  return h('section', { className: 'widget-popup', 'aria-label': 'New question from DevLens' },
    h('p', { className: 'widget-head' }, h(Mark, { kind: 'waiting' }), 'New question', h('span', { className: 'widget-count' }, pillText(snap))),
    h('p', { className: 'widget-q' }, item.text),
    h(Notice, { text: notice }),
    h('div', { className: 'widget-actions' },
      h('button', { type: 'button', className: 'btn btn--primary', onClick: () => actions.open(item.id) }, 'Answer'),
      h('button', { type: 'button', className: 'btn', onClick: actions.later }, 'Later')));
}

function Queue({ snap, notice, actions }: { snap: QueueSnapshot; notice: string | null; actions: WidgetActions }) {
  return h('section', { className: 'widget-queue', 'aria-label': 'DevLens questions' },
    h('div', { className: 'widget-bar' },
      h('p', { className: 'widget-head' }, h(Mark, { kind: markFor(snap) }), pillText(snap)),
      h('button', { type: 'button', className: 'widget-collapse', 'aria-expanded': true, onClick: actions.collapse }, 'Collapse')),
    h(Notice, { text: notice }),
    snap.error ? h('p', { className: 'widget-error', role: 'alert' }, snap.error) : null,
    snap.items.length === 0
      ? h('p', { className: 'widget-empty' }, 'No questions waiting. DevLens is watching this session.')
      : h('ol', { className: 'widget-list' }, snap.items.map((item) => h(Row, { key: item.id, item, actions }))));
}

export type WidgetViewProps = {
  mode: WidgetMode; snap: QueueSnapshot; notice: string | null; actions: WidgetActions;
  rootRef?: RefObject<HTMLDivElement | null>; demo?: boolean;
};

export function WidgetView({ mode, snap, notice, actions, rootRef, demo }: WidgetViewProps) {
  const popup = mode === 'popup' ? snap.items.find((q) => q.id === snap.popupId) : undefined;
  // The live region is always present, so a new question is announced politely. It never takes focus.
  const spoken = popup ? `New question: ${popup.text}` : notice ?? '';
  let body: ReactNode = null;
  if (mode === 'pill') body = h(Pill, { snap, notice, actions });
  if (mode === 'popup') body = h(Popup, { snap, notice, actions });
  if (mode === 'queue') body = h(Queue, { snap, notice, actions });
  return h('div', { ref: rootRef, className: demo ? 'widget widget--demo' : 'widget', 'data-mode': mode },
    h('p', { className: 'sr-only', role: 'status', 'aria-live': 'polite' }, spoken),
    body);
}

function useNotice(feed: NoticeFeed): string | null {
  const [notice, setNotice] = useState<string | null>(() => feed.notice());
  useEffect(() => {
    const off = feed.subscribe(setNotice);
    void feed.start();
    return () => { off(); feed.stop(); };
  }, [feed]);
  return notice;
}

function LiveWidget() {
  const [queue] = useState(() => createAgentQueue(undefined, { keepPolling: true }));
  const [feed] = useState(() => createRecruiterNotices());
  const [report] = useState(() => createPanelBridge());
  const snap = useAgentQueue(queue);
  const notice = useNotice(feed);
  const [expanded, setExpanded] = useState(false);
  const focusId = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mode = widgetMode(snap, expanded, notice);

  useEffect(() => { if (snap.phase !== 'on') setExpanded(false); }, [snap.phase]);

  // Measure the painted widget and tell the panel. ResizeObserver catches notices, answers, and textarea drags.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const send = () => {
      const box = el.getBoundingClientRect();
      if (report(mode, Math.ceil(box.width), Math.ceil(box.height))) console.debug('devlens widget mode', mode);
    };
    send();
    if (typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(send);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [mode, report]);

  // Focus moves only after a click on Answer or the pill (NOT-11).
  useEffect(() => {
    if (mode !== 'queue' || focusId.current === null) return;
    const target = document.getElementById(`widget-answer-${focusId.current}`) ?? document.querySelector<HTMLElement>('.widget-field, .widget-collapse');
    focusId.current = null;
    target?.focus();
  }, [mode]);

  const actions: WidgetActions = {
    open: (id) => { focusId.current = id ?? ''; queue.dismissPopup(); setExpanded(true); },
    collapse: () => setExpanded(false),
    later: () => queue.dismissPopup(),
    answer: (id, text) => { void queue.answer(id, text); },
    skip: (id) => { void queue.skip(id); },
  };
  return h(WidgetView, { mode, snap, notice, actions, rootRef });
}

// Fixed states for a visual check at /agent?demo. Nothing is fetched and nothing is posted to the panel.
const DEMO_ITEMS: QueueItem[] = [
  { id: 'd1', text: 'The retry test failed twice before you changed the timeout. What made you pick 30 seconds?', cites: [], reason: 'demo', asked_at: '', answer: null },
  { id: 'd2', text: 'You skipped the cache layer in api/orders.ts. Was that on purpose?', cites: [], reason: 'demo', asked_at: '', answer: null },
];
const demoSnap = (over: Partial<QueueSnapshot>): QueueSnapshot => ({
  phase: 'on', items: DEMO_ITEMS, popupId: null, error: null, offline: false, log: { project: 'demo', eventCount: 0, lastEventAt: null }, ...over,
});
const DEMO_STATES: { mode: WidgetMode; snap: QueueSnapshot; notice: string | null }[] = [
  { mode: 'pill', snap: demoSnap({ items: [] }), notice: null },
  { mode: 'pill', snap: demoSnap({}), notice: null },
  { mode: 'pill', snap: demoSnap({}), notice: noticeText('update') },
  { mode: 'pill', snap: demoSnap({ offline: true }), notice: null },
  { mode: 'popup', snap: demoSnap({ popupId: 'd2' }), notice: null },
  { mode: 'queue', snap: demoSnap({}), notice: noticeText('status') },
];

function DemoWidget() {
  const none = () => {};
  const actions: WidgetActions = { open: none, collapse: none, later: none, answer: none, skip: none };
  return h('div', { className: 'widget-gallery' }, DEMO_STATES.map((s, i) => h(WidgetView, { key: i, ...s, actions, demo: true })));
}

export function Widget({ demo = false }: { demo?: boolean }) {
  return demo ? h(DemoWidget) : h(LiveWidget);
}
