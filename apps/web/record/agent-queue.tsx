'use client';
// Written with createElement, not JSX: tsconfig sets jsx to preserve, so vitest cannot parse JSX in a test import.
import { createElement as h, useEffect, useState, type ReactNode } from 'react';

export type QueueItem = {
  id: string; text: string; cites: string[]; reason: string; asked_at: string;
  answer: { action: 'answer' | 'skip'; text: string; answered_at: string } | null;
};
type AgentReply = { available: boolean; enabled: boolean; session_id: string | null; questions: QueueItem[] };
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export const POLL_MS = 5000;
export const POPUP_MS = 10_000;

export type QueueSnapshot = {
  phase: 'loading' | 'unavailable' | 'off' | 'on';
  items: QueueItem[]; // open questions only
  popupId: string | null; // shown as a pop-up for 10 seconds, then it joins the queue
  error: string | null;
};

export type AgentQueue = {
  start: () => Promise<void>;
  stop: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  answer: (id: string, text: string) => Promise<void>;
  skip: (id: string) => Promise<void>;
  dismissPopup: () => void;
  snapshot: () => QueueSnapshot;
  subscribe: (listener: (snap: QueueSnapshot) => void) => () => void;
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function createAgentQueue(fetcher: FetchLike = (url, init) => fetch(url, init)): AgentQueue {
  let snap: QueueSnapshot = { phase: 'loading', items: [], popupId: null, error: null };
  const listeners = new Set<(s: QueueSnapshot) => void>();
  const seen = new Set<string>();
  let firstLoad = true;
  let poll: ReturnType<typeof setInterval> | null = null;
  let popupTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const set = (next: Partial<QueueSnapshot>) => {
    snap = { ...snap, ...next };
    listeners.forEach((listener) => listener(snap));
  };
  const clearPopup = () => {
    if (popupTimer) clearTimeout(popupTimer);
    popupTimer = null;
    if (snap.popupId !== null) set({ popupId: null });
  };
  const showPopup = (id: string) => {
    if (popupTimer) clearTimeout(popupTimer);
    set({ popupId: id });
    popupTimer = setTimeout(clearPopup, POPUP_MS);
  };
  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };
  const startPolling = () => {
    if (!poll && !stopped) poll = setInterval(() => { void load(); }, POLL_MS);
  };

  async function load(): Promise<void> {
    let reply: AgentReply;
    try {
      const res = await fetcher('/api/agent');
      if (!res.ok) throw new Error('bad status');
      reply = (await res.json()) as AgentReply;
    } catch {
      set({ error: 'Could not reach the question agent route. It will try again.' });
      return;
    }
    if (stopped) return;
    if (!reply.available) { stopPolling(); clearPopup(); set({ phase: 'unavailable', items: [], error: null }); return; }
    if (!reply.enabled) { stopPolling(); clearPopup(); set({ phase: 'off', items: [], error: null }); return; }
    const open = reply.questions.filter((q) => q.answer === null);
    const fresh = open.filter((q) => !seen.has(q.id));
    reply.questions.forEach((q) => seen.add(q.id));
    set({ phase: 'on', items: open, error: null });
    // Questions already waiting at the first load go to the queue. Only later arrivals pop up.
    if (!firstLoad && fresh.length > 0) showPopup(fresh[fresh.length - 1].id);
    firstLoad = false;
    startPolling();
  }

  async function post(body: unknown): Promise<boolean> {
    try {
      const res = await fetcher('/api/agent', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
      return res.ok;
    } catch {
      return false;
    }
  }

  return {
    start: async () => { stopped = false; await load(); },
    stop: () => { stopped = true; stopPolling(); if (popupTimer) clearTimeout(popupTimer); popupTimer = null; },
    setEnabled: async (enabled) => {
      if (!(await post({ type: 'opt_in', enabled }))) { set({ error: 'Could not save the setting.' }); return; }
      if (!enabled) { stopPolling(); clearPopup(); set({ phase: 'off', items: [], error: null }); return; }
      firstLoad = true;
      await load();
    },
    answer: async (id, text) => {
      if (!(await post({ type: 'answer', question_id: id, action: 'answer', text }))) { set({ error: 'Could not save the answer.' }); return; }
      await load();
    },
    skip: async (id) => {
      if (!(await post({ type: 'answer', question_id: id, action: 'skip' }))) { set({ error: 'Could not save the skip.' }); return; }
      await load();
    },
    dismissPopup: clearPopup,
    snapshot: () => snap,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export type AgentActions = {
  setEnabled: (enabled: boolean) => void;
  answer: (id: string, text: string) => void;
  skip: (id: string) => void;
  dismissPopup: () => void;
};

function toggleLabel(snap: QueueSnapshot): string {
  if (snap.phase === 'unavailable') return 'Question agent: unavailable, DEVLENS_PROJECT_DIR is not set';
  if (snap.phase === 'on') return 'Question agent: On';
  return snap.error ? 'Question agent: Off (could not save the setting)' : 'Question agent: Off';
}

function Row({ item, actions }: { item: QueueItem; actions: AgentActions }) {
  const [draft, setDraft] = useState('');
  const field = `agent-answer-${item.id}`;
  return h('li', { className: 'agent-item' },
    h('p', { className: 'agent-text' }, item.text),
    h('label', { htmlFor: field, className: 'agent-label' }, 'Your answer'),
    h('textarea', { id: field, className: 'agent-field', rows: 3, maxLength: 4000, value: draft, onChange: (e: { target: { value: string } }) => setDraft(e.target.value) }),
    h('div', { className: 'agent-actions' },
      h('button', { type: 'button', className: 'btn btn--primary', disabled: draft.trim().length === 0, onClick: () => actions.answer(item.id, draft) }, 'Answer'),
      h('button', { type: 'button', className: 'btn', onClick: () => actions.skip(item.id) }, 'Skip')));
}

// Off or unavailable: the toggle only. On: the toggle, a polite pop-up region, and the queue.
export function AgentPanelView({ snap, actions }: { snap: QueueSnapshot; actions: AgentActions }) {
  const on = snap.phase === 'on';
  const children: ReactNode[] = [
    h('button', {
      key: 'toggle', type: 'button', className: 'btn agent-toggle', 'aria-pressed': on, disabled: snap.phase === 'unavailable',
      onClick: () => actions.setEnabled(!on),
    }, toggleLabel(snap)),
  ];
  if (on) {
    const popup = snap.items.find((item) => item.id === snap.popupId) ?? null;
    const queued = snap.items.filter((item) => item.id !== snap.popupId);
    children.push(
      // The live region exists before its content changes. It never takes focus.
      h('div', { key: 'popup', className: 'agent-popup-region', role: 'status', 'aria-live': 'polite' },
        popup ? h('div', { className: 'agent-popup' },
          h('p', { className: 'agent-popup-label' }, 'New question'),
          h('p', { className: 'agent-text' }, popup.text),
          h('button', { type: 'button', className: 'btn', onClick: actions.dismissPopup }, 'Move to queue')) : null),
      snap.error ? h('p', { key: 'error', className: 'agent-error', role: 'alert' }, snap.error) : null,
      h('section', { key: 'queue', className: 'agent-queue', 'aria-label': 'Question queue' },
        h('h2', null, `Question queue (${queued.length})`),
        queued.length === 0 ? h('p', { className: 'note' }, 'No questions waiting.') : h('ul', { className: 'agent-list' }, queued.map((item) => h(Row, { key: item.id, item, actions })))));
  }
  return h('section', { className: 'agent-panel', 'aria-label': 'Question agent' }, children);
}

export function AgentPanel() {
  const [queue] = useState(() => createAgentQueue());
  const [snap, setSnap] = useState<QueueSnapshot>(() => queue.snapshot());
  useEffect(() => {
    const off = queue.subscribe(setSnap);
    void queue.start();
    return () => { off(); queue.stop(); };
  }, [queue]);
  const actions: AgentActions = {
    setEnabled: (enabled) => { void queue.setEnabled(enabled); },
    answer: (id, text) => { void queue.answer(id, text); },
    skip: (id) => { void queue.skip(id); },
    dismissPopup: () => queue.dismissPopup(),
  };
  return h(AgentPanelView, { snap, actions });
}
