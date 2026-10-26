export type Event = {
  id: string; session_id: string; project_id: string; ts: string; seq: number;
  actor: 'developer' | 'agent' | 'tool' | 'ci' | 'unknown';
  type: 'prompt' | 'tool_call' | 'file_edit' | 'test' | 'question' | 'answer' | 'recording_start' | 'pause' | 'resume' | 'stop';
  source: 'claude_code_hook' | 'git' | 'sandbox' | 'devlens_question' | 'media_recorder';
  provenance: 'observed' | 'inferred'; recording_ref: string | null;
  media_offset_ms: number | null; tool_use_id?: string; payload: Record<string, unknown>;
};
export type Edge = {
  id: string; src: string; dst: string;
  rel: 'prompted' | 'called' | 'edited' | 'ran_test' | 'failed' | 'supersedes' | 'verifies' | 'cites';
  derived_by: string; provenance: 'observed' | 'inferred'; evidence_event_ids: string[];
};
export type Replay = {
  mode: 'supabase' | 'local fixture'; label: string; events: Event[]; edges: Edge[];
  media: { url: string; expires_at: string | null }; warning: string | null;
};
