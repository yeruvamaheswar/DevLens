import type { ChoiceQuestion, DiffFile, FollowUpQuestion } from './types';

// Pure rules. No I/O and no model calls. Precision beats recall: plain English words are not terms.

const IDENTIFIER = /\w[_./-]\w|[a-z][A-Z]/;
const ABBREVIATION = /^["'(\[]*([a-z]\.){2,}[,;:!?"'\])]*$/i; // "e.g." and "a.k.a." are prose; "a.b.c" stays

function bareTerm(raw: string): string | null {
  if (ABBREVIATION.test(raw)) return null;
  const token = raw.replace(/^["'(\[]+/, '').replace(/[.,;:!?"'\]]+$/, '');
  const call = token.endsWith('()');
  const name = call ? token.slice(0, -2) : token.replace(/\)+$/, '');
  return name.length >= 3 && (call || IDENTIFIER.test(name)) ? name : null;
}

export function extractTerms(answer: string): string[] {
  const terms: string[] = [];
  for (const match of answer.matchAll(/`([^`]*)`|[^\s`]+/g)) {
    const term = match[1] !== undefined ? match[1].trim() : bareTerm(match[0]);
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms;
}

export function matchTerm(terms: string[], files: DiffFile[]): { term: string; file: string } | null {
  for (const term of terms) {
    // A '.' or '-' joined to more word characters continues the name: os.path is not os.path.join.
    const whole = new RegExp(`(?<![\\w$]|[\\w$][.-])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$]|[.-][\\w$])`);
    const hit = files.find((file) => file.added.some((line) => whole.test(line)));
    if (hit) return { term, file: hit.file };
  }
  return null;
}

export function followUpQuestion(parent: ChoiceQuestion, term: string, file: string, diff_event_ids: string[]): FollowUpQuestion {
  return {
    id: `${parent.id}:follow`,
    rule_id: 'C2.follow_up.v1',
    text: `You named \`${term}\`. A later change edits \`${term}\` in ${file}. How does that change relate to your answer?`,
    parent_id: parent.id, term, file,
    evidence_event_ids: [...new Set([...parent.evidence_event_ids, ...diff_event_ids])],
  };
}
