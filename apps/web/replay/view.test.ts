import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { goldenFile, localGoldenReplay } from '../../../packages/core/server';
import { ANSWER_ABSENT } from '../questions';
import { loadUsage } from '../../../packages/core/usage';
import { COMMIT_DIFF_LABEL, buildReplayView } from './view';

describe('golden replay view', () => {
  it('shows the failure, commit diffs, pass, re-run, questions, unknowns, and limits', async () => {
    const view = buildReplayView(await localGoldenReplay(), await readFile(goldenFile('git-diffs.patch'), 'utf8'));
    const ids = new Set(view.events.map((event) => event.id));
    expect(view.mode).toBe('local fixture');
    expect(view.label).toBe('golden take, broken-api, 2026-10-27');
    expect(view.events.some((event) => event.session_id === 'tracer-fixture-1')).toBe(false);
    expect(view.claim.failure.offset_ms).toBeGreaterThanOrEqual(29000);
    expect(view.claim.failure.offset_ms).toBeLessThanOrEqual(32000);
    expect(view.claim.failure.summary).toContain('wrong base URL');
    expect(view.claim.failure.origin).toBe('session hook');
    expect(view.claim.answer_note).toBe(ANSWER_ABSENT);
    expect(view.events.some((event) => event.type === 'question' || event.type === 'answer')).toBe(false);
    expect(view.claim.edits.map((event) => event.file)).toEqual(['src/client.js', 'src/client.js', 'src/client.js']);
    expect(view.claim.between).toHaveLength(2);
    expect(view.claim.pass.offset_ms).toBeGreaterThanOrEqual(177000);
    expect(view.claim.pass.offset_ms).toBeLessThanOrEqual(179000);
    expect(view.claim.pass.summary).toBe('The session test line reports a pass.');
    expect(view.claim.rerun.source).toBe('sandbox');
    expect(view.claim.rerun.id).not.toBe(view.claim.pass.id);
    expect(view.claim.rerun.offset_ms).toBeNull();
    expect(view.claim.rerun.summary).toBe('The worker re-run reports a pass.');
    expect(view.claim.origins.model).toBe('What the model said: not captured in this take.');
    expect(view.claim.origins.worker).toContain('separate from the session test line');
    expect(view.claim.diffs.map((diff) => diff.name)).toEqual(['first-fix', 'final-fix']);
    expect(view.claim.diffs.every((diff) => diff.label === COMMIT_DIFF_LABEL)).toBe(true);
    expect(view.claim.diffs[0].hook_redacted).toBe(false);
    expect(view.claim.diffs[1].hook_redacted).toBe(true);
    expect(view.claim.diffs[1].patch).toContain('Authorization:');
    expect(view.claim.diffs[1].patch).not.toContain('[REDACTED]');
    const verifies = view.claim.rules.find((rule) => rule.rel === 'verifies');
    expect(verifies?.derived_by).toBe('rule-5-later-pass-v1');
    expect(verifies?.provenance).toBe('observed');
    expect(verifies?.src).toBe(view.claim.pass.id);
    expect(verifies?.evidence_event_ids).not.toContain(view.claim.failure.id);
    expect(view.claim.rules.find((rule) => rule.rel === 'failed')?.provenance).toBe('inferred');
    expect(view.questions).toHaveLength(3);
    for (const question of view.questions) {
      expect(question.event_ids.length).toBeGreaterThan(0);
      for (const id of question.event_ids) expect(ids.has(id)).toBe(true);
    }
    expect(view.questions[0].text).toBe('The test failed, and the next prompt did not mention the error. Was that deliberate?');
    expect(view.questions[0].event_ids).toContain(view.claim.failure.id);
    expect(view.questions[1].text).toContain('Was an agent edit kept with no test until the end?');
    expect(view.questions[1].event_ids).toContain(view.claim.pass.id);
    expect(view.questions[2].text).toContain('first-fix and final-fix');
    expect(view.not_captured).toEqual(['reasoning', 'the editor', 'other terminals', 'camera', 'microphone']);
    expect(view.unknowns.some((line) => line.startsWith('Unattributed changes:'))).toBe(true);
    expect(view.unknowns.some((line) => line.includes('rule-4-failed-v1'))).toBe(true);
    expect(view.unknowns.some((line) => line.includes('job performance'))).toBe(true);
    const packed = JSON.stringify(view);
    expect(packed).not.toMatch(/\b(score|rank|hire)\b/i);
    expect(packed).not.toContain('/Users/');
    expect(packed).not.toContain('SUPABASE_SECRET_KEY');
  });
});

describe('usage and post-session answers', () => {
  const answers = [
    { question_id: 'q-next-prompt-omits-error', text: 'nope', answered_at: '2026-10-27T20:47:48Z', delivery: 'post_session', actor: 'developer' },
    { question_id: 'q-edit-untested-until-end', text: 'not sure.', answered_at: '2026-10-27T20:47:48Z', delivery: 'post_session', actor: 'developer' },
  ] as const;

  async function build(extras?: Parameters<typeof buildReplayView>[2]) {
    return buildReplayView(await localGoldenReplay(), await readFile(goldenFile('git-diffs.patch'), 'utf8'), extras);
  }

  it('renders answers verbatim with the label and marks a question with no answer', async () => {
    const view = await build({ answers });
    expect(view.questions[0].answer).toEqual({ text: 'nope', label: 'Developer answer, written after the session on 2026-10-27. Not captured during the take.' });
    expect(view.questions[1].answer?.text).toBe('not sure.');
    expect(view.questions[2].answer).toBeNull();
    expect(view.answers_present).toBe(true);
  });

  it('shows the no-answer line only when no answer exists', async () => {
    const without = await build();
    expect(without.unknowns).toContain(ANSWER_ABSENT);
    expect(without.questions.every((q) => q.answer === null)).toBe(true);
    const withAnswers = await build({ answers });
    expect(withAnswers.unknowns).not.toContain(ANSWER_ABSENT);
    expect(withAnswers.unknowns).toContain('Developer answers were written after the session, not during the take.');
    expect(withAnswers.claim.answer_note).toBe('Developer answers were written after the session, not during the take.');
  });

  it('swaps the usage unknowns line and builds the panel data from the golden file', async () => {
    const usage = await loadUsage(goldenFile('usage.jsonl'));
    const view = await build({ usage });
    expect(view.unknowns).not.toContain('Model and token data were not read for this take.');
    expect(view.unknowns).toContain('Coding-agent usage is shown as context. It is not a measure of skill or efficiency.');
    expect(view.usage).toMatchObject({ requests: 11, models: ['claude-sonnet-5-5'], input_tokens: 22, output_tokens: 2434, cache_write_1h: 82753, cache_write_5m: 0, cache_read: 664323, price_table: 'claude-pricing-2026-10-27', price_table_date: '2026-10-27', billing_route_label: 'plan (assumed)', note: "Billed to the developer's plan, not charged per token. Not comparable to other sessions." });
    const old = await build();
    expect(old.usage).toBeNull();
    expect(old.unknowns).toContain('Model and token data were not read for this take.');
  });

  it('keeps verdict words out of the view text', async () => {
    const usage = await loadUsage(goldenFile('usage.jsonl'));
    const view = await build({ usage, answers });
    const text = JSON.stringify({ usage: view.usage, unknowns: view.unknowns, q: view.questions.map((q) => [q.text, q.answer]) });
    const stripped = text.replace('It is not a measure of skill or efficiency.', '');
    expect(stripped).not.toMatch(/efficient|score|rank|better|worse|hire/i);
  });
});
