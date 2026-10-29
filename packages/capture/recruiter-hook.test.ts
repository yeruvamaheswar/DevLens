import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { processHook, type AgentSpawner } from './hook';

function project(files: { share?: string; agent?: string } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-recruiter-hook-'));
  mkdirSync(path.join(dir, '.devlens'));
  if (files.share !== undefined) writeFileSync(path.join(dir, '.devlens', 'share.json'), files.share);
  if (files.agent !== undefined) writeFileSync(path.join(dir, '.devlens', 'agent.json'), files.agent);
  return dir;
}

function recorder() {
  const calls: string[][] = [];
  const spawner: AgentSpawner = (_command, args) => {
    calls.push(args);
    return { unref: () => {} };
  };
  return { calls, spawner };
}

const T0 = Date.parse('2026-10-28T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);
const prompt = (dir: string, id: string, text: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: id, prompt: text, cwd: dir });
const stop = (dir: string, id: string, extra: Record<string, unknown> = {}) => ({ hook_event_name: 'Stop', session_id: 's1', prompt_id: id, cwd: dir, ...extra });
const updates = (dir: string) => {
  const file = path.join(dir, '.devlens', 'recruiter.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind: string; lines: { text: string; cites: string[] }[] }) : [];
};

describe('recruiter trigger at Stop', () => {
  it('with sharing on, a Stop after a new prompt appends one update citing the prompt event', () => {
    const dir = project({ share: '{"enabled":true}' });
    processHook(prompt(dir, 'p1', 'Add the list total'), { env: {}, now: at(1) });
    const result = processHook(stop(dir, 'p1'), { env: {}, now: at(2) });
    expect(result.updated).toBe(true);
    const [entry] = updates(dir);
    expect(entry.kind).toBe('update');
    expect(entry.lines[0]).toEqual({ text: 'Add the list total', cites: ['s1:UserPromptSubmit:p1'], prompt: true });
  });

  it('with sharing off, appends nothing', () => {
    const dir = project();
    processHook(prompt(dir, 'p1', 'Add the list total'), { env: {}, now: at(1) });
    expect(processHook(stop(dir, 'p1'), { env: {}, now: at(2) }).updated).toBe(false);
    expect(updates(dir)).toEqual([]);
  });

  it('respects the gap and needs a new prompt', () => {
    const dir = project({ share: '{"enabled":true}' });
    const env = { DEVLENS_UPDATE_EVERY_MIN: '10' };
    processHook(prompt(dir, 'p1', 'one'), { env, now: at(1) });
    processHook(stop(dir, 'p1'), { env, now: at(2) });
    processHook(prompt(dir, 'p2', 'two'), { env, now: at(3) });
    expect(processHook(stop(dir, 'p2'), { env, now: at(4) }).updated).toBe(false); // inside the gap
    expect(processHook(stop(dir, 'p2b'), { env, now: at(30) }).updated).toBe(true); // p2 is still new
    expect(processHook(stop(dir, 'p2c'), { env, now: at(60) }).updated).toBe(false); // no new prompt
    expect(updates(dir)).toHaveLength(2);
  });

  it('does nothing for stop_hook_active, SessionEnd, or a prompt', () => {
    const dir = project({ share: '{"enabled":true}' });
    processHook(prompt(dir, 'p1', 'one'), { env: {}, now: at(1) });
    processHook(stop(dir, 'p1', { stop_hook_active: true }), { env: {}, now: at(2) });
    processHook({ ...stop(dir, 'p1'), hook_event_name: 'SessionEnd' }, { env: {}, now: at(3) });
    expect(updates(dir)).toEqual([]);
  });

  it('a recruiter failure warns once, never throws, and still spawns the agent unchanged', () => {
    const dir = project({ share: '{"enabled":true}', agent: '{"enabled":true}' });
    mkdirSync(path.join(dir, '.devlens', 'recruiter.jsonl')); // a folder where the file belongs: the read fails
    const warnings: string[] = [];
    const { calls, spawner } = recorder();
    processHook(prompt(dir, 'p1', 'one'), { env: {}, now: at(1) });
    const result = processHook(stop(dir, 'p1'), { env: {}, now: at(2), spawner, warn: (line) => warnings.push(line) });
    expect(result).toMatchObject({ spawned: true, updated: false });
    expect(result.event?.id).toBe('s1:Stop:p1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^devlens hook: recruiter update not sent: /);
    expect(calls).toEqual([[expect.stringMatching(/cli\.mjs$/), expect.stringMatching(/cli\.ts$/), dir, 's1', 's1:Stop:p1']]);
  });

  it('with both on, sends the update and spawns the agent once', () => {
    const dir = project({ share: '{"enabled":true}', agent: '{"enabled":true}' });
    const { calls, spawner } = recorder();
    processHook(prompt(dir, 'p1', 'one'), { env: {}, now: at(1) });
    const result = processHook(stop(dir, 'p1'), { env: {}, now: at(2), spawner });
    expect(result).toMatchObject({ spawned: true, updated: true });
    expect(calls).toHaveLength(1);
    expect(updates(dir)).toHaveLength(1);
  });
});
