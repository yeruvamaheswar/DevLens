'use client';
// Written with createElement, not JSX: tsconfig sets jsx to preserve, so vitest cannot parse JSX in a test import.
// The question views moved to the bottom-right widget (apps/web/agent/widget.tsx, CR-8). This file keeps the controller.
import { useEffect, useState } from 'react';

export type QueueItem = {
  id: string; text: string; cites: string[]; reason: string; asked_at: string;
  answer: { action: 'answer' | 'skip'; text: string; answered_at: string } | null;
};
type AgentReply = {
  available: boolean; enabled: boolean; session_id: string | null; questions: QueueItem[];
  project?: string | null; event_count?: number; last_event_at?: string | null;
};
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export const POLL_MS = 5000;
export const POPUP_MS = 10_000;

// Facts about the session log in the project folder. They come from the hooks, whatever the agent setting.
export type SessionLog = { project: string | null; eventCount: number; lastEventAt: string | null };

export type QueueSnapshot = {
  phase: 'loading' | 'unavailable' | 'off' | 'on';
  items: QueueItem[]; // open questions only
  popupId: string | null; // shown as a pop-up for 10 seconds, then it joins the queue
  error: string | null;
  offline: boolean; // the last fetch of /api/agent failed; polling retries it
  log: SessionLog;
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

// keepPolling: also poll while the agent is off, so a page sees the switch flip and the event count grow.
export type AgentQueueOptions = { keepPolling?: boolean };

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EMPTY_LOG: SessionLog = { project: null, eventCount: 0, lastEventAt: null };

function logFrom(reply: AgentReply): SessionLog {
  return {
    project: typeof reply.project === 'string' ? reply.project : null,
    eventCount: typeof reply.event_count === 'number' ? reply.event_count : 0,
    lastEventAt: typeof reply.last_event_at === 'string' ? reply.last_event_at : null,
  };
}

export function createAgentQueue(fetcher: FetchLike = (url, init) => fetch(url, init), options: AgentQueueOptions = {}): AgentQueue {
  let snap: QueueSnapshot = { phase: 'loading', items: [], popupId: null, error: null, offline: false, log: EMPTY_LOG };
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
  const turnedOff = (phase: 'off' | 'unavailable', log: SessionLog) => {
    if (phase === 'unavailable' || !options.keepPolling) stopPolling();
    else startPolling();
    clearPopup();
    set({ phase, items: [], error: null, offline: false, log });
  };

  async function load(): Promise<void> {
    let reply: AgentReply;
    try {
      const res = await fetcher('/api/agent');
      if (!res.ok) throw new Error('bad status');
      reply = (await res.json()) as AgentReply;
    } catch {
      if (stopped) return;
      set({ offline: true, error: 'Could not reach the DevLens server. Retrying every 5 seconds.' });
      startPolling(); // Retry until the server answers again.
      return;
    }
    if (stopped) return;
    const log = logFrom(reply);
    if (!reply.available) { turnedOff('unavailable', EMPTY_LOG); return; }
    if (!reply.enabled) { turnedOff('off', log); return; }
    const open = reply.questions.filter((q) => q.answer === null);
    const fresh = open.filter((q) => !seen.has(q.id));
    reply.questions.forEach((q) => seen.add(q.id));
    set({ phase: 'on', items: open, error: null, offline: false, log });
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
      if (!(await post({ type: 'opt_in', enabled }))) { set({ error: 'Could not save the setting. Check that DevLens is running, then try again.' }); return; }
      if (!enabled) { turnedOff('off', snap.log); return; }
      firstLoad = true;
      await load();
    },
    answer: async (id, text) => {
      if (!(await post({ type: 'answer', question_id: id, action: 'answer', text }))) { set({ error: 'Could not save the answer. Your text is still here; try Answer again.' }); return; }
      await load();
    },
    skip: async (id) => {
      if (!(await post({ type: 'answer', question_id: id, action: 'skip' }))) { set({ error: 'Could not save the skip. Try Skip again.' }); return; }
      await load();
    },
    dismissPopup: clearPopup,
    snapshot: () => snap,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// Start a controller with the component and stop it on unmount. Server render shows the first snapshot only.
export function useAgentQueue(queue: AgentQueue): QueueSnapshot {
  const [snap, setSnap] = useState<QueueSnapshot>(() => queue.snapshot());
  useEffect(() => {
    const off = queue.subscribe(setSnap);
    void queue.start();
    return () => { off(); queue.stop(); };
  }, [queue]);
  return snap;
}
