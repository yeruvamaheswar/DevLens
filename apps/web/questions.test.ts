import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Event } from '../../packages/core/event';
import { ANSWER_ABSENT, reviewerQuestions, unknownLines } from './questions';

function ev(partial: Partial<Event> & Pick<Event, 'id' | 'type' | 'ts'>): Event {
  return {
    session_id: 's',
    project_id: 'p',
    seq: 1,
    actor: 'agent',
    source: 'claude_code_hook',
    provenance: 'observed',
    recording_ref: null,
    media_offset_ms: 0,
    payload: {},
    ...partial,
  };
}

describe('reviewer questions', () => {
  it('asks when the next prompt leaves out the assertion', () => {
    const failure = ev({
      id: 'f',
      type: 'test',
      ts: '2026-10-27T00:00:01.000Z',
      payload: { status: 'failed', output: 'AssertionError [ERR_ASSERTION]: wrong base URL: expected /api, received /v0' },
    });
    const prompt = ev({
      id: 'p',
      type: 'prompt',
      ts: '2026-10-27T00:00:02.000Z',
      actor: 'developer',
      payload: { prompt: 'Run npm test' },
    });
    const question = reviewerQuestions([failure, prompt], []).find((item) => item.rule_id === 'rule-q1-next-prompt-omits-error-v1');
    expect(question?.text).toBe('The test failed, and the next prompt did not mention the error. Was that deliberate?');
    expect(question?.event_ids).toEqual(['f', 'p']);
  });

  it('stays quiet when the next prompt names the assertion', () => {
    const failure = ev({
      id: 'f',
      type: 'test',
      ts: '2026-10-27T00:00:01.000Z',
      payload: { status: 'failed', output: 'AssertionError [ERR_ASSERTION]: wrong base URL: expected /api, received /v0' },
    });
    const prompt = ev({
      id: 'p',
      type: 'prompt',
      ts: '2026-10-27T00:00:02.000Z',
      actor: 'developer',
      payload: { prompt: 'wrong base URL: expected /api, received /v0' },
    });
    expect(reviewerQuestions([failure, prompt], []).some((item) => item.rule_id.startsWith('rule-q1'))).toBe(false);
  });

  it('cites an edit that waited until the last test', () => {
    const editA = ev({ id: 'a', type: 'file_edit', ts: '2026-10-27T00:00:01.000Z', payload: { files: ['src/client.js'] } });
    const editB = ev({ id: 'b', type: 'file_edit', ts: '2026-10-27T00:00:02.000Z', payload: { files: ['src/client.js'] } });
    const pass = ev({ id: 'pass', type: 'test', ts: '2026-10-27T00:00:03.000Z', payload: { status: 'passed', output: 'ok' } });
    const question = reviewerQuestions([editA, editB, pass], []).find((item) => item.rule_id === 'rule-q2-edit-untested-until-end-v1');
    expect(question?.text).toContain('Was an agent edit kept with no test until the end?');
    expect(question?.event_ids).toEqual(['a', 'b', 'pass']);
  });

  it('asks who made a commit that has no hooked event', () => {
    const edit = ev({ id: 'e', type: 'file_edit', ts: '2026-10-27T00:00:01.000Z', payload: { files: ['src/client.js'] } });
    const question = reviewerQuestions([edit], [{ name: 'starter' }, { name: 'final-fix' }]).find((item) => item.rule_id === 'rule-q3-unhooked-commit-v1');
    expect(question?.event_ids).toEqual(['e']);
    expect(question?.text).toContain('Who made the final-fix commit?');
    expect(question?.text).toContain('no hooked event does');
  });

  it('does not call a model', async () => {
    const source = await readFile('apps/web/questions.ts', 'utf8');
    expect(source).not.toMatch(/openai|anthropic|generateText/i);
  });
});

describe('unknown lines', () => {
  it('swaps the usage and answer lines only when that data exists', () => {
    const none = unknownLines([], [], []);
    expect(none).toContain('Model and token data were not read for this take.');
    expect(none).toContain(ANSWER_ABSENT);
    const both = unknownLines([], [], [], { usage: true, answers: true });
    expect(both).toContain('Coding-agent usage is shown as context. It is not a measure of skill or efficiency.');
    expect(both).not.toContain('Model and token data were not read for this take.');
    expect(both).not.toContain(ANSWER_ABSENT);
    expect(both).toContain('Developer answers were written after the session, not during the take.');
  });
});
