import { recordAnswer } from './ask';
import { extractTerms, followUpQuestion, matchTerm } from './follow';
import type { ChoiceQuestion, LiveConfig, LiveInput, LiveState, LiveStep, QuestionStatus, TrackedQuestion } from './types';

// Pure rules. No I/O, no model, inputs never mutated. A question is shown in the panel only (NOT-8).
// Unanswered is only a status. No score, rank, or penalty wording (NOT-1).

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
  warmup_ms: 3 * 60_000, cooldown_ms: 5 * 60_000, window_ms: 30 * 60_000, max_live_per_window: 3, max_per_session: 5,
};

export function startLive(session_id: string, session_start_ms: number): LiveState {
  return { session_id, session_start_ms, muted: false, phase: 'live', live_asked_at_ms: [], questions: [] };
}

const total = (state: LiveState) => state.questions.filter((q) => q.status !== 'suppressed').length;

function track(state: LiveState, question: TrackedQuestion['question'], at_ms: number, config: LiveConfig): LiveState {
  if (state.questions.some((q) => q.question.id === question.id)) return state;
  // After session_end a new question waits for the report; after report_close it expires at once.
  const open: QuestionStatus = state.phase === 'live' ? 'queued' : state.phase === 'ended' ? 'post_session' : 'expired';
  const status: QuestionStatus = total(state) >= config.max_per_session ? 'suppressed' : open;
  const tracked: TrackedQuestion = { question, status, queued_at_ms: at_ms, asked_at_ms: null, answer: null, terms: [], follow_up_id: null };
  return { ...state, questions: [...state.questions, tracked] };
}

function update(state: LiveState, id: string, change: Partial<TrackedQuestion>): LiveState {
  return { ...state, questions: state.questions.map((q) => (q.question.id === id ? { ...q, ...change } : q)) };
}

function move(state: LiveState, from: QuestionStatus[], to: QuestionStatus): LiveState {
  return { ...state, questions: state.questions.map((q) => (from.includes(q.status) ? { ...q, status: to } : q)) };
}

function find(state: LiveState, id: string | null): TrackedQuestion {
  const found = state.questions.find((q) => q.question.id === id);
  if (!found) throw new Error(`Unknown question id: ${id}`);
  return found;
}

export function step(state: LiveState, input: LiveInput, config: LiveConfig = DEFAULT_LIVE_CONFIG): LiveStep {
  switch (input.kind) {
    case 'questions': {
      let next = state;
      for (const question of input.questions) next = track(next, question, input.at_ms, config);
      return { state: next, ask: null };
    }
    case 'stop': {
      const { at_ms } = input;
      const open = state.questions.some((q) => q.status === 'asked');
      const last = state.live_asked_at_ms.length ? Math.max(...state.live_asked_at_ms) : null;
      const inWindow = state.live_asked_at_ms.filter((t) => t > at_ms - config.window_ms).length;
      const next = state.questions.find((q) => q.status === 'queued');
      if (state.phase !== 'live' || state.muted || !next || open || at_ms < state.session_start_ms + config.warmup_ms
        || (last !== null && at_ms - last < config.cooldown_ms) || inWindow >= config.max_live_per_window) {
        return { state, ask: null };
      }
      const ask: TrackedQuestion = { ...next, status: 'asked', asked_at_ms: at_ms };
      return { state: { ...update(state, next.question.id, ask), live_asked_at_ms: [...state.live_asked_at_ms, at_ms] }, ask };
    }
    case 'answer': {
      const target = find(state, input.question_id);
      if (target.status !== 'asked' && target.status !== 'deferred' && target.status !== 'post_session') {
        throw new Error(`Question ${input.question_id} cannot be answered in status ${target.status}`);
      }
      const delivery = target.status === 'asked' ? 'live' : 'post_session';
      // recordAnswer takes a ChoiceQuestion but only reads its id, so a follow-up works too.
      const answer = recordAnswer(target.question as ChoiceQuestion, input.text, new Date(input.at_ms).toISOString(), delivery);
      return { state: update(state, input.question_id, { status: 'answered', answer, terms: extractTerms(input.text) }), ask: null };
    }
    case 'control': {
      if (input.action === 'mute') return { state: move({ ...state, muted: true }, ['queued'], 'post_session'), ask: null };
      const target = find(state, input.question_id);
      if (target.status !== 'asked') throw new Error(`Question ${input.question_id} is not open, so ${input.action} does not apply`);
      return { state: update(state, target.question.id, { status: input.action === 'skip' ? 'skipped' : 'deferred' }), ask: null };
    }
    case 'diff': {
      let next = state;
      for (const parent of state.questions) {
        if (parent.status !== 'answered' || parent.question.rule_id !== 'C1.choice.v1' || parent.follow_up_id !== null || parent.terms.length === 0) continue;
        const hit = matchTerm(parent.terms, input.files);
        if (!hit) continue;
        const follow = followUpQuestion(parent.question, hit.term, hit.file, input.event_ids);
        next = update(track(next, follow, input.at_ms, config), parent.question.id, { follow_up_id: follow.id });
      }
      return { state: next, ask: null };
    }
    case 'session_end':
      return { state: move({ ...state, phase: state.phase === 'closed' ? 'closed' : 'ended' }, ['queued', 'asked'], 'post_session'), ask: null };
    case 'report_close':
      return { state: move({ ...state, phase: 'closed' }, ['queued', 'asked', 'post_session', 'deferred'], 'expired'), ask: null };
  }
}
