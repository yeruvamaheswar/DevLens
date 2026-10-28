import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '../../../../packages/capture/append-event';
import { redactString, secretValuesFromEnv, shortSecretValuesFromEnv } from '../../../../packages/capture/redact';
import type { Event } from '../../../../packages/core/event';

export type QueueItem = {
  id: string; text: string; cites: string[]; reason: string; asked_at: string;
  answer: { action: 'answer' | 'skip'; text: string; answered_at: string } | null;
};
export type AgentState = { available: boolean; enabled: boolean; session_id: string | null; questions: QueueItem[] };

export const MAX_ANSWER_CHARS = 4000;

// The folder comes only from the server's own environment. A client never names a path.
export function projectDirFromEnv(env: Record<string, string | undefined>): string | null {
  const raw = env.DEVLENS_PROJECT_DIR;
  return typeof raw === 'string' && raw.trim().length > 0 ? path.resolve(raw.trim()) : null;
}

const agentFile = (dir: string) => path.join(dir, '.devlens', 'agent.json');
const eventsFile = (dir: string) => path.join(dir, '.devlens', 'events.jsonl');

export function readOptIn(dir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(agentFile(dir), 'utf8')) as { enabled?: unknown } | null;
    return parsed !== null && typeof parsed === 'object' && parsed.enabled === true;
  } catch {
    return false;
  }
}

function readAllEvents(dir: string): Event[] {
  let text: string;
  try { text = readFileSync(eventsFile(dir), 'utf8'); } catch { return []; }
  const out: Event[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const value = JSON.parse(line) as Event;
      if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.session_id === 'string') out.push(value);
    } catch { /* skip a torn line */ }
  }
  return out;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function foldSession(events: Event[], sessionId: string): QueueItem[] {
  const answers = new Map<string, Event>();
  for (const event of events) if (event.session_id === sessionId && event.type === 'answer' && event.source === 'devlens_question') answers.set(str(event.payload.question_id), event);
  const items: QueueItem[] = [];
  for (const event of events) {
    if (event.session_id !== sessionId || event.type !== 'question' || event.source !== 'devlens_question') continue;
    const reply = answers.get(event.id);
    const cites = Array.isArray(event.payload.cites) ? event.payload.cites.filter((c): c is string => typeof c === 'string') : [];
    items.push({
      id: event.id, text: str(event.payload.text), cites, reason: str(event.payload.reason), asked_at: event.ts,
      answer: reply ? { action: reply.payload.action === 'skip' ? 'skip' : 'answer', text: str(reply.payload.text), answered_at: str(reply.payload.answered_at) } : null,
    });
  }
  return items;
}

export function readAgentState(dir: string | null): AgentState {
  if (!dir) return { available: false, enabled: false, session_id: null, questions: [] };
  if (!readOptIn(dir)) return { available: true, enabled: false, session_id: null, questions: [] };
  const events = readAllEvents(dir);
  const sessionId = events.length > 0 ? events[events.length - 1].session_id : null;
  return { available: true, enabled: true, session_id: sessionId, questions: sessionId ? foldSession(events, sessionId) : [] };
}

export type PostResult = { status: number; body: Record<string, unknown> };
const bad = (error: string, status = 400): PostResult => ({ status, body: { error } });

export function applyPost(dir: string | null, input: unknown, env: Record<string, string | undefined> = process.env, now = new Date()): PostResult {
  if (!dir) return bad('agent unavailable: DEVLENS_PROJECT_DIR is not set', 503);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return bad('body must be an object');
  const body = input as Record<string, unknown>;

  if (body.type === 'opt_in') {
    if (typeof body.enabled !== 'boolean') return bad('enabled must be true or false');
    mkdirSync(path.dirname(agentFile(dir)), { recursive: true });
    writeFileSync(agentFile(dir), `${JSON.stringify({ enabled: body.enabled })}\n`, 'utf8');
    return { status: 200, body: { enabled: body.enabled } };
  }

  if (body.type === 'answer') {
    if (!readOptIn(dir)) return bad('agent is off', 409);
    if (typeof body.question_id !== 'string' || body.question_id.length === 0 || body.question_id.length > 500) return bad('question_id is required');
    if (body.action !== 'answer' && body.action !== 'skip') return bad('action must be answer or skip');
    let text = '';
    if (body.action === 'answer') {
      if (typeof body.text !== 'string' || body.text.trim().length === 0) return bad('text is required for an answer');
      if (body.text.length > MAX_ANSWER_CHARS) return bad(`text is longer than ${MAX_ANSWER_CHARS} characters`);
      text = redactString(body.text, secretValuesFromEnv(env), shortSecretValuesFromEnv(env));
    }
    const events = readAllEvents(dir);
    const question = events.find((event) => event.id === body.question_id && event.type === 'question' && event.source === 'devlens_question');
    if (!question) return bad('unknown question', 404);
    const answerId = `${question.id}:answer`;
    if (events.some((event) => event.id === answerId)) return bad('already answered', 409);
    const ended = events.some((event) => event.session_id === question.session_id && event.type === 'stop' && event.payload.hook_event_name === 'SessionEnd');
    const written = appendEvent(eventsFile(dir), {
      id: answerId, session_id: question.session_id, project_id: question.project_id, ts: now.toISOString(), seq: 0,
      actor: 'developer', type: 'answer', source: 'devlens_question', provenance: 'observed', recording_ref: null, media_offset_ms: null,
      payload: { question_id: question.id, text, answered_at: now.toISOString(), delivery: ended ? 'post_session' : 'live', actor: 'developer', action: body.action },
    });
    return { status: 200, body: { id: written.id } };
  }

  return bad('type must be opt_in or answer');
}
