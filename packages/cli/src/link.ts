import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { Edge, Event } from '../../core/event';
import { dedupeEvents, linkEvents } from '../../link/src/rules';

// Replace-session writer. Service role stays in server env. Host must be the tracer project.
// Each session is written by one rpc call, public.replace_session (migration 20261026240000), which
// runs in one transaction. All sessions are validated and prepared before the first rpc.
// --dry-run prints counts and does not open a client.

const PROJECT_HOST = 'hivfaqlabtbrhrviwrrm.supabase.co';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

type Loaded = { event: Event; order: number };
type SessionPlan = { sessionId: string; events: Event[]; edges: Edge[] };
type Plan = { events: Event[]; edges: Edge[]; sessions: SessionPlan[] };
type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type RpcClient = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export class LinkWriteError extends Error {
  constructor(message: string, readonly succeeded: readonly string[]) {
    super(message);
  }
}

export function assertTracerProject(url: string): void {
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  if (host !== PROJECT_HOST) throw new Error('Project does not match the authorized tracer project.');
}

function usage(): never {
  throw new Error('Usage: devlens link --fixture [--dry-run] | devlens link <events.jsonl> [--rerun <rerun.jsonl>] [--dry-run]');
}

export function parseLinkArgs(argv: readonly string[]): { fixture: boolean; dryRun: boolean; events?: string; rerun?: string } {
  const args = argv[0] === 'link' ? argv.slice(1) : [...argv];
  let fixture = false;
  let dryRun = false;
  let events: string | undefined;
  let rerun: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fixture') fixture = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--rerun') {
      rerun = args[++i];
      if (!rerun) usage();
    } else if (arg.startsWith('--')) usage();
    else if (!events) events = arg;
    else usage();
  }
  if (fixture === Boolean(events) || (fixture && rerun)) usage();
  return { fixture, dryRun, events, rerun };
}

async function readJsonl(file: string, orderStart: number): Promise<Loaded[]> {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { throw new Error(`Cannot read ${path.basename(file)}`); }
  const loaded: Loaded[] = [];
  let order = orderStart;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new Error(`Event line ${i + 1} is not JSON`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Event line ${i + 1} is not an object`);
    const event = parsed as Event;
    if (typeof event.id !== 'string' || !event.id || typeof event.session_id !== 'string' || !event.session_id) throw new Error(`Event line ${i + 1} is missing an id`);
    if (typeof event.ts !== 'string' || typeof event.type !== 'string' || !event.payload || typeof event.payload !== 'object') throw new Error(`Event line ${i + 1} is missing ts, type, or payload`);
    loaded.push({ event, order: order++ });
  }
  return loaded;
}

export function planSession(loaded: readonly Loaded[]): Plan {
  // Dedupe by id first: this throws on conflicting copies before any sort, seq, or write.
  const orderOf = new Map<Event, number>();
  for (const item of loaded) orderOf.set(item.event, item.order);
  const unique = dedupeEvents(loaded.map((item) => item.event));
  const bySession = new Map<string, Event[]>();
  for (const event of unique) {
    const group = bySession.get(event.session_id) ?? [];
    group.push(event);
    bySession.set(event.session_id, group);
  }
  const sessions: SessionPlan[] = [];
  for (const [sessionId, group] of bySession) {
    const ordered = [...group].sort((a, b) => a.ts.localeCompare(b.ts) || (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));
    const events = ordered.map((event, index) => ({ ...event, seq: index + 1 }));
    sessions.push({ sessionId, events, edges: linkEvents(events) });
  }
  return { events: sessions.flatMap((s) => s.events), edges: sessions.flatMap((s) => s.edges), sessions };
}

function eventRow(event: Event) {
  return {
    id: event.id,
    session_id: event.session_id,
    project_id: event.project_id,
    ts: event.ts,
    seq: event.seq,
    actor: event.actor,
    type: event.type,
    source: event.source,
    provenance: event.provenance,
    recording_ref: event.recording_ref,
    media_offset_ms: event.media_offset_ms,
    tool_use_id: event.tool_use_id ?? null,
    payload: event.payload,
  };
}

function edgeRow(edge: Edge) {
  return {
    id: edge.id,
    src: edge.src,
    dst: edge.dst,
    rel: edge.rel,
    derived_by: edge.derived_by,
    provenance: edge.provenance,
    evidence_event_ids: edge.evidence_event_ids,
  };
}

function isMissingFunction(error: { message?: string; code?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message ?? '');
}

// One rpc per session. A failure stops the run and reports which sessions were already replaced.
export async function writeSessions(client: RpcClient, sessions: readonly SessionPlan[]): Promise<string[]> {
  const succeeded: string[] = [];
  for (const session of sessions) {
    const result = await client.rpc('replace_session', {
      p_session_id: session.sessionId,
      p_events: session.events.map(eventRow),
      p_edges: session.edges.map(edgeRow),
    });
    if (result.error) {
      const done = succeeded.length > 0 ? ` Sessions already replaced: ${succeeded.join(', ')}.` : '';
      if (isMissingFunction(result.error)) {
        throw new LinkWriteError(`replace_session function not found; apply migration 20261026240000. Nothing was changed.${done}`, succeeded);
      }
      throw new LinkWriteError(`Link failed for session ${session.sessionId}; that session was left unchanged (atomic replace).${done}`, succeeded);
    }
    const counts = result.data as { events?: number; edges?: number } | null;
    if (!counts || counts.events !== session.events.length || counts.edges !== session.edges.length) {
      throw new LinkWriteError(`Link for session ${session.sessionId} returned unexpected counts.${succeeded.length > 0 ? ` Sessions already replaced: ${succeeded.join(', ')}.` : ''}`, succeeded);
    }
    succeeded.push(session.sessionId);
  }
  return succeeded;
}

function loadServerEnv(): { url: string; secret: string } {
  try { process.loadEnvFile?.(path.join(repoRoot, '.env')); } catch { /* A missing file is reported below. */ }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('Link requires server configuration; no data was sent.');
  assertTracerProject(url);
  return { url, secret };
}

export async function runLink(options: { fixture: boolean; dryRun: boolean; events?: string; rerun?: string }, client?: RpcClient): Promise<Plan> {
  const files: string[] = [];
  if (options.fixture) files.push(path.join(repoRoot, 'examples', 'broken-api', 'fixtures', 'session.jsonl'));
  else if (options.events) files.push(path.resolve(options.events));
  if (options.rerun) files.push(path.resolve(options.rerun));
  let loaded: Loaded[] = [];
  for (const file of files) loaded = loaded.concat(await readJsonl(file, loaded.length));
  const plan = planSession(loaded);
  console.log(`events: ${plan.events.length}`);
  console.log(`edges: ${plan.edges.length}`);
  if (options.dryRun || plan.events.length === 0) return plan;
  let target = client;
  if (!target) {
    const { url, secret } = loadServerEnv();
    target = createClient(url, secret, { auth: { persistSession: false } });
  }
  await writeSessions(target, plan.sessions);
  return plan;
}

async function main(): Promise<void> {
  const planArgs = parseLinkArgs(process.argv.slice(2));
  await runLink(planArgs);
}

const calledDirectly = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (calledDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'link failed';
    console.error(message.includes('eyJ') || message.includes('sb_secret') ? 'link failed' : message);
    process.exitCode = 1;
  });
}
