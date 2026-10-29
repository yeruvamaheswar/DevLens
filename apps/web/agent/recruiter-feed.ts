// Client side of GET/POST /api/recruiter (DEC-25). The route itself belongs to the recruiter slice.
import { POLL_MS, type FetchLike } from '../record/agent-queue';

export const NOTICE_MS = 5000;

type Entry = { id: string; kind: 'update' | 'status' };
type RecruiterReply = { sharing?: unknown; updates?: unknown };

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

async function getRecruiter(fetcher: FetchLike): Promise<RecruiterReply | null> {
  try {
    const res = await fetcher('/api/recruiter');
    if (!res.ok) return null; // 404 while the route is not built, or any failure: treat as absent.
    const body = (await res.json()) as unknown;
    return body !== null && typeof body === 'object' ? (body as RecruiterReply) : null;
  } catch {
    return null;
  }
}

function entriesOf(reply: RecruiterReply): Entry[] {
  if (!Array.isArray(reply.updates)) return [];
  return reply.updates.filter((u): u is Entry => u !== null && typeof u === 'object'
    && typeof (u as Entry).id === 'string' && ((u as Entry).kind === 'update' || (u as Entry).kind === 'status'));
}

export function noticeText(kind: Entry['kind']): string {
  return kind === 'status' ? 'Recruiter asked for status · sent' : 'Sent update to recruiter';
}

// Widget notices: a new entry shows a short line for 5 seconds. Entries present at the first answer stay silent.
export type NoticeFeed = {
  start: () => Promise<void>;
  stop: () => void;
  notice: () => string | null;
  subscribe: (listener: (notice: string | null) => void) => () => void;
};

export function createRecruiterNotices(fetcher: FetchLike = defaultFetch): NoticeFeed {
  const seen = new Set<string>();
  const listeners = new Set<(notice: string | null) => void>();
  let seeded = false;
  let current: string | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const set = (next: string | null) => {
    current = next;
    listeners.forEach((listener) => listener(current));
  };

  async function load(): Promise<void> {
    const reply = await getRecruiter(fetcher);
    if (stopped || reply === null) return;
    const entries = entriesOf(reply);
    const fresh = entries.filter((e) => !seen.has(e.id));
    entries.forEach((e) => seen.add(e.id));
    if (!seeded) { seeded = true; return; }
    if (fresh.length === 0) return;
    if (timer) clearTimeout(timer);
    set(noticeText(fresh[fresh.length - 1].kind));
    timer = setTimeout(() => { timer = null; set(null); }, NOTICE_MS);
  }

  return {
    start: async () => {
      stopped = false;
      await load();
      if (!poll && !stopped) poll = setInterval(() => { void load(); }, POLL_MS);
    },
    stop: () => {
      stopped = true;
      if (poll) clearInterval(poll);
      poll = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    notice: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// The /record sharing switch. It reads the opt-in once and posts only when the developer flips it.
export type ShareSnapshot = { phase: 'loading' | 'unavailable' | 'ready'; sharing: boolean; error: string | null };

export type ShareSwitch = {
  start: () => Promise<void>;
  setSharing: (enabled: boolean) => Promise<void>;
  snapshot: () => ShareSnapshot;
  subscribe: (listener: (snap: ShareSnapshot) => void) => () => void;
};

export function createShareSwitch(fetcher: FetchLike = defaultFetch): ShareSwitch {
  let snap: ShareSnapshot = { phase: 'loading', sharing: false, error: null };
  const listeners = new Set<(s: ShareSnapshot) => void>();
  const set = (next: Partial<ShareSnapshot>) => {
    snap = { ...snap, ...next };
    listeners.forEach((listener) => listener(snap));
  };

  return {
    start: async () => {
      const reply = await getRecruiter(fetcher);
      if (reply === null) { set({ phase: 'unavailable', sharing: false }); return; }
      set({ phase: 'ready', sharing: reply.sharing === true, error: null });
    },
    setSharing: async (enabled) => {
      if (snap.phase !== 'ready') return;
      let ok = false;
      try {
        const res = await fetcher('/api/recruiter', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type: 'share', enabled }) });
        ok = res.ok;
      } catch { ok = false; }
      if (!ok) { set({ error: 'Could not save the sharing setting. Check that DevLens is running, then try again.' }); return; }
      set({ sharing: enabled, error: null });
    },
    snapshot: () => snap,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
