// Review Questions C1 shared contract (plans/devlens-review-questions.md). Rules only. No model, no I/O.
// Owned by the Tech Lead. Builders must not change this file; report a needed change instead.

export type Category =
  | 'ui_framework' | 'meta_framework' | 'python_web_framework' | 'node_web_framework'
  | 'database' | 'orm' | 'test_framework' | 'state_management';

export type Ecosystem = 'npm' | 'pypi';

// One option in a category. Several packages can map to one option (react, react-dom -> React).
export type CatalogOption = {
  id: string;            // stable slug, e.g. 'react'
  name: string;          // display name, e.g. 'React'
  category: Category;
  packages: Partial<Record<Ecosystem, string[]>>; // exact package names, lowercase
};
export type Catalog = { version: string; categories: Record<Category, string>; options: CatalogOption[] }; // categories: id -> label, e.g. 'UI framework'

export type ManifestKind = 'package.json' | 'requirements.txt';
export type DependencyField = 'dependencies' | 'devDependencies' | 'requirements';

// One manifest change. `before` is null when the file is new. Text is the raw file content.
export type ManifestChange = { path: string; kind: ManifestKind; before: string | null; after: string; event_ids: string[] };

// A dependency that was added in `after` and is not in `before`, matched to one catalog option.
export type DetectedChoice = {
  option_id: string; option_name: string;
  category: Category; category_label: string;
  package: string; field: DependencyField; manifest_path: string;
  evidence_event_ids: string[];
};

// A question to ask. Text comes from a template, never a model.
export type ChoiceQuestion = {
  id: string;            // deterministic: `${session_id}:choice:${option_id}`
  rule_id: 'C1.choice.v1';
  text: string;
  option_id: string; category: Category;
  peers: string[];       // display names from the same category, at most 2, catalog order, excluding the chosen option
  evidence_event_ids: string[];
};

// Per-session state for dedupe. One question per option and per category per session.
export type AskState = { session_id: string; asked_option_ids: string[]; asked_categories: Category[] };

// A developer answer to a choice question. Stored verbatim.
export type ChoiceAnswer = {
  question_id: string; text: string; answered_at: string;
  delivery: 'live' | 'post_session'; actor: 'developer';
};

// ---- C2: live slot, caps, cooldown, follow-up (exploration plan section 6, contract DEC-14, NOT-8). ----
// A question is shown in the DevLens panel only. It is never sent into the coding agent's context (NOT-8).

export type LiveConfig = {
  warmup_ms: number;            // no live question before session_start + warmup
  cooldown_ms: number;          // min gap between two live questions
  window_ms: number;            // rolling window for the live cap
  max_live_per_window: number;
  max_per_session: number;      // all questions, live and post-session, follow-ups included
};

// A follow-up after an answer names a term that a later diff changes. At most one per question.
export type FollowUpQuestion = {
  id: string;                   // `${parent_id}:follow`
  rule_id: 'C2.follow_up.v1';
  text: string;
  parent_id: string; term: string; file: string;
  evidence_event_ids: string[]; // the parent's ids plus the diff's ids
};

export type QuestionStatus =
  | 'queued' | 'asked' | 'answered' | 'skipped' | 'deferred' | 'post_session' | 'suppressed' | 'expired';

export type TrackedQuestion = {
  question: ChoiceQuestion | FollowUpQuestion;
  status: QuestionStatus;
  queued_at_ms: number; asked_at_ms: number | null;
  answer: ChoiceAnswer | null;
  terms: string[];              // from the answer, for the follow-up match
  follow_up_id: string | null;  // set once a follow-up was created
};

export type LiveState = {
  session_id: string; session_start_ms: number; muted: boolean;
  phase: 'live' | 'ended' | 'closed'; // set by session_end and report_close; never goes back
  live_asked_at_ms: number[];   // times of live asks, for cooldown and the window cap
  questions: TrackedQuestion[]; // in queue order
};

// A changed file. `added` holds the added lines only, without the leading '+'.
export type DiffFile = { file: string; added: string[] };

export type LiveInput =
  | { kind: 'stop'; at_ms: number; event_id: string }                       // Claude Code Stop hook: the only live slot
  | { kind: 'questions'; questions: ChoiceQuestion[]; at_ms: number }        // from askChoices
  | { kind: 'answer'; question_id: string; text: string; at_ms: number }
  | { kind: 'control'; action: 'not_now' | 'skip' | 'mute'; question_id: string | null; at_ms: number }
  | { kind: 'diff'; files: DiffFile[]; event_ids: string[]; at_ms: number }
  | { kind: 'session_end'; at_ms: number }                                    // queued and open asks move to post_session
  | { kind: 'report_close'; at_ms: number };                                  // unanswered post_session/deferred become expired

export type LiveStep = { state: LiveState; ask: TrackedQuestion | null };   // ask: the question to show now, if any

// packages/questions/src/follow.ts exports (C2a):
//   extractTerms(answer: string): string[]
//   matchTerm(terms: string[], files: DiffFile[]): { term: string; file: string } | null
//   followUpQuestion(parent: ChoiceQuestion, term: string, file: string, diff_event_ids: string[]): FollowUpQuestion
// packages/questions/src/live.ts exports (C2b):
//   DEFAULT_LIVE_CONFIG: LiveConfig, startLive(session_id: string, session_start_ms: number): LiveState,
//   step(state: LiveState, input: LiveInput, config?: LiveConfig): LiveStep
