export type Event = {
  id: string; session_id: string; project_id: string; ts: string; seq: number;
  actor: 'developer' | 'agent' | 'tool' | 'ci' | 'unknown';
  type: 'prompt' | 'tool_call' | 'file_edit' | 'test' | 'question' | 'answer' | 'recording_start' | 'pause' | 'resume' | 'stop';
  source: 'claude_code_hook' | 'git' | 'sandbox' | 'devlens_question' | 'media_recorder';
  provenance: 'observed' | 'inferred'; recording_ref: string | null;
  media_offset_ms: number | null; tool_use_id?: string | null; payload: Record<string, unknown>;
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

// ---- Wave 3 shared contracts (Slice 2 review, plans/devlens-architecture-review.md). Types only. ----
// Event ids are global primary keys. Hook ids: `<session_id>:<tool_use_id>:pre|post` for tools,
// `<session_id>:<hook_event_name>:<prompt_id>` for prompt/Stop. Never use a counter in an id.
// `seq` from a producer is advisory; the single ingest writer reassigns 1..n by (ts, file order) per session.
// Unattributed work: actor 'unknown' + payload.attribution 'unattributed' + provenance 'inferred'. Never 'developer'.
export type TestPayload = {
  status: 'passed' | 'failed' | 'unknown';
  command: string; output: string; files?: string[];
  signal: 'hook_failure' | 'output_parse' | 'rerun'; // how status was decided
  patch_event_id?: string; prompt_id?: string; duration_ms?: number; rerun_of?: string;
};
export type FileEditPayload = { files: string[]; diff?: string; tool_name?: string; attribution?: 'unattributed' };
export type HookPayload = { hook_event_name: string; phase?: 'pre' | 'post' | 'failure'; tool_name?: string; prompt_id?: string; raw?: Record<string, unknown> };
// Rule contract (Slice 5): pure, no I/O, no model. Output edges must cite real input event ids and a rule id in derived_by.
export type LinkRule = (events: readonly Event[]) => Edge[];
// Recorder contract (Slice 4 writes it; sync.ts consumes it). Times are epoch ms from Date.now().
export type PauseSpan = { pause_ms: number; resume_ms: number };
export type RecordingMeta = {
  recording_id: string; recording_ref: string; mode: 'window' | 'desktop';
  display_surface: 'window' | 'monitor' | 'browser' | 'unknown';
  consent: true; audio_tracks: 0; video_tracks: 1;
  wall_start_ms: number; wall_end_ms: number | null; pauses: PauseSpan[]; bytes: number | null;
};
export type RecordingMetaInput = Omit<RecordingMeta, 'recording_ref'>; // POST /api/recordings/<id>/meta body; the server adds recording_ref
export type RecordingGrant = { recording_id: string; path: string; token: string }; // POST /api/recordings response

// Coding-agent usage for one API request. Numbers and ids only. Context, never a measure.
export type UsageRecord = {
  session_id: string; request_id: string; model: string;
  input_tokens: number; output_tokens: number;
  cache_write_5m: number; cache_write_1h: number; cache_read: number;
  list_price_usd: number; price_table: string; billing_route: 'plan';
};
// A developer answer written after the session. Stored verbatim.
export type PostSessionAnswer = {
  question_id: string; text: string; answered_at: string;
  delivery: 'post_session'; actor: 'developer';
};
