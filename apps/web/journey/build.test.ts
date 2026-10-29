import { describe, expect, it } from 'vitest';
import type { Event } from '../../../packages/core/event';
import { localGoldenReplay } from '../../../packages/core/server';
import { buildJourney, type JourneySourceMeta } from './build';
import { journeyLayout, LAYOUT } from './layout';

const SOURCE: JourneySourceMeta = { key: 'test', label: 'test', adapter: 'claude_code_hook', status: 'verified', provenance_note: '', unknowns: [], not_captured: [], media: null };

describe('journey over the golden Claude Code take', async () => {
  const replay = await localGoldenReplay();
  const journey = buildJourney({ events: replay.events, edges: replay.edges, source: SOURCE });
  const ids = new Set(replay.events.map((event) => event.id));

  it('finds every step of the failure-to-fix chain on real stations', () => {
    expect(journey.chain.map((step) => [step.key, step.station != null])).toEqual([
      ['failure', true],
      ['first_fix', true],
      ['still_failing', true],
      ['response', true],
      ['revised_fix', true],
      ['pass', true],
      ['verification', true],
    ]);
  });

  it('never invents an event: every station cites recorded event ids', () => {
    for (const station of journey.stations) {
      expect(station.event_ids.length).toBeGreaterThan(0);
      for (const id of [...station.event_ids, ...station.context_ids]) expect(ids.has(id)).toBe(true);
    }
  });

  it('keeps time order on the session line and puts the re-run on a branch', () => {
    const main = journey.stations.filter((station) => !station.branch);
    for (let i = 1; i < main.length; i++) expect(Date.parse(main[i].ts)).toBeGreaterThanOrEqual(Date.parse(main[i - 1].ts));
    const branch = journey.stations.filter((station) => station.branch);
    expect(branch.map((station) => station.kind)).toEqual(['verified']);
    expect(branch[0].offset_ms).toBeNull();
  });

  it('labels derived stations and does not count the hook pre event as an extra action', () => {
    expect(journey.stations.find((station) => station.kind === 'response')?.derived).toMatch(/event order/);
    expect(journey.stations.filter((station) => station.kind === 'actions').every((station) => station.derived)).toBe(true);
    expect(journey.counts).toMatchObject({ prompts: 2, edits: 3, tests: 4, failed: 3, passed: 1, reruns: 1 });
  });

  it('writes three questions that cite recorded events', () => {
    expect(journey.questions).toHaveLength(3);
    for (const question of journey.questions) for (const id of question.event_ids) expect(ids.has(id)).toBe(true);
  });

  it('lays out inside the drawing, with the branch below its row', () => {
    const layout = journeyLayout(journey.stations);
    for (const station of layout.stations) {
      expect(station.x).toBeGreaterThan(0);
      expect(station.x).toBeLessThan(LAYOUT.width);
    }
    const branch = layout.stations.find((station) => station.branch)!;
    const pass = layout.stations.find((station) => station.kind === 'test_passed')!;
    expect(branch.y).toBeGreaterThan(pass.y);
  });
});

function ev(id: string, minute: number, type: Event['type'], actor: Event['actor'], payload: Record<string, unknown>, extra: Partial<Event> = {}): Event {
  return { id, session_id: 't3:x', project_id: 'p', ts: `2026-10-29T15:${String(minute).padStart(2, '0')}:00.000Z`, seq: minute, actor, type, source: 't3_code', provenance: 'observed', recording_ref: null, media_offset_ms: null, payload, ...extra };
}

describe('journey over provider-neutral events', () => {
  const sonnet = { provider: 'claudeAgent', model: 'claude-sonnet-5-5', basis: 'model selection T3 recorded for this run', run_ordinal: 1 };
  const codex = { provider: 'codex', model: 'gpt-6.1-sol', basis: 'model selection T3 recorded for this run', run_ordinal: 2 };
  const events: Event[] = [
    ev('p1', 1, 'prompt', 'developer', { prompt: 'Fix the filter', agent: sonnet }),
    ev('t1', 2, 'test', 'tool', { status: 'failed', command: 'npm test', output: 'AssertionError [ERR_ASSERTION]: expected 200, got 400', agent: sonnet }),
    ev('e1', 3, 'file_edit', 'agent', { files: ['src/validate.js'], agent: sonnet }),
    ev('t2', 4, 'test', 'tool', { status: 'failed', command: 'npm test', output: 'AssertionError [ERR_ASSERTION]: expected 3 issues, got 0', agent: sonnet }),
    ev('p2', 5, 'prompt', 'developer', { prompt: 'Normalize the status once', agent: codex }),
    ev('e2', 6, 'file_edit', 'agent', { files: ['src/status.js'], agent: codex }),
    ev('u1', 7, 'file_edit', 'unknown', { files: ['data/a'], attribution: 'unattributed', agent: codex }, { provenance: 'inferred' }),
    ev('u2', 7, 'file_edit', 'unknown', { files: ['data/b'], attribution: 'unattributed', agent: codex }, { provenance: 'inferred' }),
    ev('t3', 8, 'test', 'tool', { status: 'passed', command: 'npm test', output: 'ℹ pass 10\nℹ fail 0', agent: codex }),
  ];
  const journey = buildJourney({ events, edges: [], source: { ...SOURCE, adapter: 't3_code', status: 'experimental' } });

  it('shows a model switch where the run changes provider or model', () => {
    const kinds = journey.stations.map((station) => station.kind);
    expect(kinds).toEqual(['start', 'prompt', 'test_failed', 'edit', 'test_failed', 'switch', 'response', 'edit', 'unattributed', 'test_passed']);
    expect(journey.stations.find((station) => station.kind === 'switch')?.detail).toBe('claudeAgent · claude-sonnet-5-5 → codex · gpt-6.1-sol');
    expect(journey.agents.map((agent) => agent.label)).toEqual(['claudeAgent · claude-sonnet-5-5', 'codex · gpt-6.1-sol']);
  });

  it('groups unattributed changes and never gives them an agent', () => {
    const station = journey.stations.find((item) => item.kind === 'unattributed')!;
    expect(station.event_ids).toEqual(['u1', 'u2']);
    expect(station.agent).toBeNull();
  });

  it('says a missing verification in words instead of filling it in', () => {
    const step = journey.chain.find((item) => item.key === 'verification')!;
    expect(step.station).toBeNull();
    expect(journey.unknowns).toContain('No independent re-run is recorded for the passing test.');
  });

  it('draws nothing but the start for a session with no events', () => {
    expect(buildJourney({ events: [], edges: [], source: SOURCE }).stations).toEqual([]);
  });
});

describe('chain order and attribution (review findings 2, 3, 4)', () => {
  const at = (key: string, journey: ReturnType<typeof buildJourney>) => journey.chain.find((step) => step.key === key)!;
  const run = (events: Event[]) => buildJourney({ events, edges: [], source: { ...SOURCE, adapter: 't3_code', status: 'experimental' } });

  it('when the developer answers before any change, the first change is the revised code', () => {
    const journey = run([
      ev('t1', 1, 'test', 'tool', { status: 'failed', command: 'npm test', output: 'AssertionError [ERR_ASSERTION]: got 400' }),
      ev('p1', 2, 'prompt', 'developer', { prompt: 'Fix the status filter' }),
      ev('e1', 3, 'file_edit', 'agent', { files: ['src/validate.js'] }),
      ev('t2', 4, 'test', 'tool', { status: 'passed', command: 'npm test', output: 'ℹ pass 26\nℹ fail 0' }),
    ]);
    expect(at('first_fix', journey).station).toBeNull();
    expect(at('still_failing', journey).station).toBeNull();
    expect(at('response', journey).station).toBe('p1');
    expect(at('revised_fix', journey).station).toBe('edit:e1');
    expect(at('pass', journey).station).toBe('t2');
  });

  it('an agent-written prompt is its own kind and does not hide the developer response', () => {
    const journey = run([
      ev('t1', 1, 'test', 'tool', { status: 'failed', command: 'npm test', output: 'x' }),
      ev('a1', 2, 'prompt', 'agent', { prompt: 'Review the change', attribution: 'agent_authored' }),
      ev('p1', 3, 'prompt', 'developer', { prompt: 'Normalize the status once' }),
      ev('e1', 4, 'file_edit', 'agent', { files: ['src/status.js'] }),
      ev('t2', 5, 'test', 'tool', { status: 'passed', command: 'npm test', output: 'ℹ pass 1\nℹ fail 0' }),
    ]);
    const kinds = Object.fromEntries(journey.stations.map((station) => [station.id, station.kind]));
    expect(kinds.a1).toBe('agent_prompt');
    expect(kinds.p1).toBe('response');
    expect(at('response', journey).station).toBe('p1');
  });

  it('a prompt after a passing test is not called a response to the old failure', () => {
    const journey = run([
      ev('t1', 1, 'test', 'tool', { status: 'failed', command: 'npm test', output: 'x' }),
      ev('e1', 2, 'file_edit', 'agent', { files: ['a.js'] }),
      ev('t2', 3, 'test', 'tool', { status: 'passed', command: 'npm test', output: 'ℹ pass 1\nℹ fail 0' }),
      ev('p1', 4, 'prompt', 'developer', { prompt: 'Now add a CSV export' }),
    ]);
    expect(journey.stations.find((station) => station.id === 'p1')?.kind).toBe('prompt');
    expect(at('still_failing', journey).note).toBe('The first fix passed. No second failure.');
    expect(at('response', journey).station).toBeNull();
  });
});
