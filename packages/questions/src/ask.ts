import type { AskState, Catalog, ChoiceAnswer, ChoiceQuestion, DetectedChoice } from './types';

// Pure rules. No I/O and no model calls. Question text comes from a template.

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// "Database" -> "database", "UI framework" stays.
function lowerFirst(label: string): string {
  return label.length > 1 && label[1] === label[1].toLowerCase() ? label[0].toLowerCase() + label.slice(1) : label;
}

export function questionText(choice: DetectedChoice, peers: string[]): string {
  const alternatives = peers.length === 0 ? 'Which alternatives did you consider?'
    : `Which alternatives did you consider, for example ${peers.slice(0, 2).join(' or ')}?`;
  return `You added \`${choice.package}\` for the ${lowerFirst(choice.category_label)}. Why ${choice.option_name}? ${alternatives}`;
}

export function peersFor(option_id: string, catalog: Catalog): string[] {
  const chosen = catalog.options.find((option) => option.id === option_id);
  if (!chosen) return [];
  return catalog.options
    .filter((option) => option.category === chosen.category && option.id !== option_id)
    .slice(0, 2)
    .map((option) => option.name);
}

export function askChoices(state: AskState, choices: DetectedChoice[], catalog: Catalog): { questions: ChoiceQuestion[]; state: AskState } {
  const asked_option_ids = [...state.asked_option_ids];
  const asked_categories = [...state.asked_categories];
  const questions: ChoiceQuestion[] = [];
  for (const choice of choices) {
    if (asked_option_ids.includes(choice.option_id) || asked_categories.includes(choice.category)) continue;
    const peers = peersFor(choice.option_id, catalog);
    asked_option_ids.push(choice.option_id);
    asked_categories.push(choice.category);
    questions.push({
      id: `${state.session_id}:choice:${choice.option_id}`,
      rule_id: 'C1.choice.v1',
      text: questionText(choice, peers),
      option_id: choice.option_id,
      category: choice.category,
      peers,
      evidence_event_ids: [...choice.evidence_event_ids],
    });
  }
  return { questions, state: { session_id: state.session_id, asked_option_ids, asked_categories } };
}

// Date.parse rolls 2026-02-30 over to March, so check the calendar date itself.
function realDate(iso: string): boolean {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d && !Number.isNaN(Date.parse(iso));
}

export function recordAnswer(question: ChoiceQuestion, text: string, answered_at: string, delivery: 'live' | 'post_session'): ChoiceAnswer {
  if (!ISO_TIMESTAMP.test(answered_at) || !realDate(answered_at)) {
    throw new Error(`answered_at is not a valid ISO timestamp: ${answered_at}`);
  }
  return { question_id: question.id, text, answered_at, delivery, actor: 'developer' };
}
