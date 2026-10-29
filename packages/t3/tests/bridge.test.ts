import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Event } from '../../core/event';
import { bridgeQuestions } from '../src/bridge';
import type { CaptureRun } from '../src/map';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function app(optIn: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-t3-bridge-'));
  dirs.push(dir);
  if (optIn) {
    mkdirSync(path.join(dir, '.devlens'));
    writeFileSync(path.join(dir, '.devlens', 'agent.json'), JSON.stringify({ enabled: true }));
  }
  return dir;
}

const ev = (id: string, source: Event['source'] = 't3_code'): Event => ({
  id, session_id: 't3:th1', project_id: 'p', ts: '2026-10-29T18:00:00.000Z', seq: 1, actor: 'developer', type: 'prompt', source, provenance: 'observed', recording_ref: null, media_offset_ms: null, payload: { prompt: 'x' },
});
const run = (ordinal: number, status: string, completed: string | null): CaptureRun => ({
  provider: 'claudeAgent', model: 'm', options: {}, run_id: `r${ordinal}`, run_ordinal: ordinal, run_status: status, provider_thread_id: null, basis: 'model selection T3 recorded for this run', requested_at: 't', completed_at: completed, prompt_by: 'user',
});

describe('T3 question bridge (CR-12: questions for T3 sessions)', () => {
  it('does nothing without the agent opt-in', () => {
    const calls: string[] = [];
    const result = bridgeQuestions({ root: app(false), events: [ev('a')], runs: [run(1, 'completed', 't')], started: new Set(), startAgent: (_d, _s, stop) => calls.push(stop) });
    expect(result.skipped).toBe('opt_in_off');
    expect(calls).toEqual([]);
  });

  it('copies new session events once and starts the agent once per completed run', () => {
    const root = app(true);
    const calls: string[] = [];
    const started = new Set<string>();
    const startAgent = (_d: string, session: string, stop: string) => calls.push(`${session}|${stop}`);
    const first = bridgeQuestions({ root, events: [ev('a'), ev('rerun', 'sandbox')], runs: [run(1, 'completed', 't'), run(2, 'running', null)], started, startAgent });
    expect(first.appended).toBe(1);
    expect(calls).toEqual(['t3:th1|t3:th1:run:1']);
    const second = bridgeQuestions({ root, events: [ev('a'), ev('b')], runs: [run(1, 'completed', 't'), run(2, 'completed', 't2')], started, startAgent });
    expect(second.appended).toBe(1);
    expect(calls).toEqual(['t3:th1|t3:th1:run:1', 't3:th1|t3:th1:run:2']);
    const lines = readFileSync(path.join(root, '.devlens', 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line).id);
    expect(lines).toEqual(['a', 'b']);
  });
});
