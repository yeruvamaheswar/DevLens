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
