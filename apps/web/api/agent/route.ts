import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyPost, projectDirFromEnv, readAgentState } from './state';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export type SessionLogFacts = { project: string | null; event_count: number; last_event_at: string | null };

// Facts for the /record "Session log" row: the project folder name and the latest session's event count.
// The hooks write this log whatever the agent setting, so it is read even when the agent is off.
export function sessionLogFacts(dir: string | null): SessionLogFacts {
  if (!dir) return { project: null, event_count: 0, last_event_at: null };
  const project = path.basename(dir);
  let text: string;
  try { text = readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8'); } catch { return { project, event_count: 0, last_event_at: null }; }
  const events: { session_id: string; ts: unknown }[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const value = JSON.parse(line) as { id?: unknown; session_id?: unknown; ts?: unknown } | null;
      if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.session_id === 'string') events.push({ session_id: value.session_id, ts: value.ts });
    } catch { /* skip a torn line */ }
  }
  if (events.length === 0) return { project, event_count: 0, last_event_at: null };
  const session = events[events.length - 1].session_id;
  const mine = events.filter((event) => event.session_id === session);
  const last = mine[mine.length - 1].ts;
  return { project, event_count: mine.length, last_event_at: typeof last === 'string' ? last : null };
}

export async function GET() {
  const dir = projectDirFromEnv(process.env);
  return Response.json({ ...readAgentState(dir), ...sessionLogFacts(dir) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const dir = projectDirFromEnv(process.env);
  // A JSON content type forces a cross-origin page to ask first. Nothing is read from an odd request.
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'body was not JSON' }, { status: 400, headers: NO_STORE });
  }
  const result = applyPost(dir, input);
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}
