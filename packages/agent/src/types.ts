import type { Event } from '../../core/event';

export type EngineRoute = 'claude_cli' | 'anthropic_api';
export type EngineResult =
  | { ok: true; text: string; route: EngineRoute; model: string; duration_ms: number }
  | { ok: false; error: string; route: EngineRoute; model: string; duration_ms: number };
export type QuestionEngine = { route: EngineRoute; model: string; complete(system: string, user: string, timeout_ms: number): Promise<EngineResult> };
export type AgentQuestion = { id: string; text: string; cites: string[]; reason: string }; // id assigned by DevLens, not the model
export type AgentContext = { session_id: string; events: Event[]; repo_files: string[]; files: { path: string; text: string }[]; prior: { question: string; answer: string | null }[] };
