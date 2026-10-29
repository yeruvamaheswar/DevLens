export const MAX_QUESTION_CHARS = 300;

// NOT-8 and NOT-10: no score, rank, hire verdict, or fix in a question.
// Fix rule: match imperative forms that suggest a fix. A plain "could", "verdict", or "why did you try a retry" is allowed.
const BANNED: { name: string; pattern: RegExp }[] = [
  { name: 'score', pattern: /\b(scor(e|es|ed|ing)|grad(e|es|ed|ing)|rating|rated)\b/i },
  { name: 'rank', pattern: /\b(rank(s|ed|ing)?|percentile|top \d+%)\b/i },
  { name: 'hire', pattern: /\b(hir(e|es|ed|ing)|hireable|hireability|hire verdict|candidate fit|pass(es)? the bar)\b/i },
  { name: 'fix', pattern: /\b(fix(es|ed|ing)?|you should|you must|you ought|should have|better (way|approach|option)|consider (using|switching|changing|adding)|try (using|adding|switching|changing|moving|removing)|change (it|this|that) to|switch to|instead,? (use|try)|use \w+ instead|i (suggest|recommend))\b/i },
];

// Fold look-alike forms (NFKC), then remove every default-ignorable and format character.
// Those characters are invisible or split a word, so they can hide a banned word.
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const BAD_CONTROL = /[^\P{Cc}\n\t]/u; // any control character except newline and tab
export function normalize(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '');
}
export function hasBadControl(text: string): boolean {
  return BAD_CONTROL.test(text);
}

// The same score, rank, hire, and fix filter, for other text built from the session (recruiter updates).
// Returns `banned_<name>` for the first match, or null. Normalizes first, so look-alike forms cannot hide a word.
// `allow` skips named rules: a quoted developer prompt may say "fix", since those are the developer's words, not advice.
export function bannedReason(text: string, allow: readonly string[] = []): string | null {
  const cleaned = normalize(text);
  for (const { name, pattern } of BANNED) if (!allow.includes(name) && pattern.test(cleaned)) return `banned_${name}`;
  return null;
}

export type Verdict = { ok: true; text: string; cites: string[]; reason: string } | { ok: false; reason: string; empty?: boolean };

// `clean` runs first (normalize, then redact). The banned-word check and the kept text both use its output,
// so the stored text is exactly the validated text.
// `ids.developer` holds the developer's own events: a question must rest on at least one, so it is about what they asked for.
export function validateReply(raw: string, ids: { all: ReadonlySet<string>; developer: ReadonlySet<string> }, clean: (text: string) => string = normalize): Verdict {
  let body = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(body);
  if (fence) body = fence[1];
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { ok: false, reason: 'not_json' }; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !('question' in parsed)) return { ok: false, reason: 'bad_schema' };
  const question = (parsed as { question: unknown }).question;
  if (question === null) return { ok: false, reason: 'no_question', empty: true };
  if (question === undefined || typeof question !== 'object' || Array.isArray(question)) return { ok: false, reason: 'bad_schema' };
  const { text, cites } = question as { text?: unknown; cites?: unknown };
  if (typeof text !== 'string' || text.trim().length === 0 || !Array.isArray(cites) || !cites.every((c) => typeof c === 'string')) return { ok: false, reason: 'bad_schema' };
  const normalized = normalize(text);
  if (hasBadControl(normalized)) return { ok: false, reason: 'control_character' };
  const cleaned = normalize(clean(normalized)).trim();
  if (hasBadControl(cleaned)) return { ok: false, reason: 'control_character' };
  if (cleaned.length === 0) return { ok: false, reason: 'bad_schema' };
  if (cleaned.length > MAX_QUESTION_CHARS) return { ok: false, reason: 'too_long' };
  if (cites.length === 0) return { ok: false, reason: 'no_citation' };
  if ((cites as string[]).some((id) => !ids.all.has(id))) return { ok: false, reason: 'unknown_event_id' };
  if (!(cites as string[]).some((id) => ids.developer.has(id))) return { ok: false, reason: 'no_developer_citation' };
  for (const { name, pattern } of BANNED) if (pattern.test(cleaned)) return { ok: false, reason: `banned_${name}` };
  const unique = [...new Set(cites as string[])];
  return { ok: true, text: cleaned, cites: unique, reason: `cites ${unique.length} real session event${unique.length === 1 ? '' : 's'}` };
}
