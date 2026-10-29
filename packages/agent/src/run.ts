import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '../../capture/append-event';
import { redactString, secretValuesFromEnv, shortSecretValuesFromEnv } from '../../capture/redact';
import type { Event } from '../../core/event';
import { buildContext, readEvents } from './context';
import { selectEngine } from './engines';
import { acquire, ledgerPathFor, recordResult, reserveSlot } from './ledger';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import type { AgentQuestion, QuestionEngine } from './types';
import { normalize, validateReply } from './validate';

export { selectEngine } from './engines';
export const CALL_TIMEOUT_MS = 60_000;

export function isOptedIn(projectDir: string): boolean {
  try {
    const file = path.join(projectDir, '.devlens', 'agent.json');
    if (!existsSync(file)) return false;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { enabled?: unknown };
    return parsed !== null && typeof parsed === 'object' && parsed.enabled === true;
  } catch { return false; }
}

export async function runAtStop(opts: { projectDir: string; session_id: string; stop_event_id: string; engine?: QuestionEngine; now?: Date }): Promise<{ asked: AgentQuestion[]; skipped: string | null }> {
  const skip = (reason: string) => ({ asked: [] as AgentQuestion[], skipped: reason });
  const now = opts.now ?? new Date();
  if (!isOptedIn(opts.projectDir)) return skip('opt_in_off');

  const eventsPath = path.join(opts.projectDir, '.devlens', 'events.jsonl');
  const events = readEvents(eventsPath, opts.session_id);
  if (events.length === 0) return skip('no_session_events');
  const questionId = `${opts.session_id}:devlens_question:${opts.stop_event_id}`;
  if (events.some((event) => event.id === questionId)) return skip('already_asked_at_this_stop');

  const context = buildContext(opts.projectDir, opts.session_id, events);
  const env = process.env;
  const secrets = secretValuesFromEnv(env);
  const shorts = shortSecretValuesFromEnv(env);
  const system = SYSTEM_PROMPT;
  const user = redactString(buildUserPrompt(context), secrets, shorts);

  const ledgerPath = ledgerPathFor(opts.projectDir);
  const slot = reserveSlot(ledgerPath, opts.session_id, opts.stop_event_id, now);
  if (!slot.ok) return skip(slot.reason);

  const engine = opts.engine ?? selectEngine(env);
  let result;
  try {
    result = await engine.complete(system, user, CALL_TIMEOUT_MS);
  } catch (error) {
    result = { ok: false as const, error: error instanceof Error ? error.message : String(error), route: engine.route, model: engine.model, duration_ms: 0 };
  }
  recordResult(ledgerPath, opts.session_id, result, now);
  if (!result.ok) return skip('engine_error');

  const ids = { all: new Set(events.map((event) => event.id)), developer: new Set(context.events.filter((event) => event.actor === 'developer' && event.type === 'prompt').map((event) => event.id)) };
  const verdict = validateReply(result.text, ids, (text) => redactString(normalize(text), secrets, shorts));
  if (!verdict.ok) return skip(verdict.empty ? 'no_question' : `dropped_${verdict.reason}`);

  // The repeat check and the append share one lock, so two runs at one Stop cannot both append.
  const release = acquire(`${eventsPath}.agent.lock`);
  if (!release) return skip('events_locked');
  try {
    if (readEvents(eventsPath, opts.session_id).some((event) => event.id === questionId)) return skip('already_asked_at_this_stop');
    const written: Event = appendEvent(eventsPath, {
      id: questionId, session_id: opts.session_id, project_id: events[0].project_id, ts: now.toISOString(), seq: 0,
      actor: 'tool', type: 'question', source: 'devlens_question', provenance: 'inferred', recording_ref: null, media_offset_ms: null,
      payload: { text: verdict.text, cites: verdict.cites, reason: verdict.reason, stop_event_id: opts.stop_event_id, route: result.route, model: result.model },
    });
    return { asked: [{ id: written.id, text: verdict.text, cites: verdict.cites, reason: verdict.reason }], skipped: null };
  } finally { release(); }
}
