import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { processHook, type AgentSpawner } from './hook';

function project(agentJson?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-agent-hook-'));
  if (agentJson !== undefined) {
    mkdirSync(path.join(dir, '.devlens'));
    writeFileSync(path.join(dir, '.devlens', 'agent.json'), agentJson);
  }
  return dir;
}

function recorder() {
  const calls: { command: string; args: string[]; options: unknown; unref: number }[] = [];
  const spawner: AgentSpawner = (command, args, options) => {
    const call = { command, args, options, unref: 0 };
    calls.push(call);
    return { unref: () => { call.unref += 1; } };
  };
  return { calls, spawner };
}

const stop = (dir: string, extra: Record<string, unknown> = {}) => ({ hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: dir, ...extra });

describe('agent hook', () => {
  it('writes nothing and prints nothing when DEVLENS_AGENT=1', () => {
    const dir = project('{"enabled":true}');
    const tsx = path.join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(process.execPath, [tsx, path.join(__dirname, 'hook.ts')], {
      input: JSON.stringify(stop(dir)), encoding: 'utf8', env: { ...process.env, DEVLENS_AGENT: '1', CLAUDE_PROJECT_DIR: dir },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(existsSync(path.join(dir, '.devlens', 'events.jsonl'))).toBe(false);
  });

  it.each([
    ['missing file', undefined],
    ['enabled false', '{"enabled":false}'],
    ['bad JSON', '{nope'],
    ['enabled not true', '{"enabled":"yes"}'],
  ])('spawns nothing with the opt-in off (%s) and still appends the Stop event', (_name, content) => {
    const dir = project(content);
    const { calls, spawner } = recorder();
    const result = processHook(stop(dir), { env: {}, spawner });
    expect(calls).toHaveLength(0);
    expect(result.spawned).toBe(false);
    expect(readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8')).toContain('"s1:Stop:p1"');
  });

  it('spawns the agent once for a Stop with the opt-in on, after the event is appended', () => {
    const dir = project('{"enabled":true}');
    const { calls, spawner } = recorder();
    const result = processHook(stop(dir), { env: {}, spawner });
    expect(result.spawned).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.command).toBe(process.execPath);
    expect(call.args[0]).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
    expect(call.args[1].replaceAll('\\', '/')).toMatch(/packages\/agent\/src\/cli\.ts$/);
    expect(call.args.slice(2)).toEqual([dir, 's1', 's1:Stop:p1']);
    expect(call.options).toEqual({ detached: true, stdio: 'ignore' });
    expect(call.unref).toBe(1);
    expect(readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8')).toContain('"s1:Stop:p1"');
  });

  it('spawns nothing for SessionEnd or stop_hook_active', () => {
    const dir = project('{"enabled":true}');
    const { calls, spawner } = recorder();
    processHook({ ...stop(dir), hook_event_name: 'SessionEnd' }, { env: {}, spawner });
    processHook(stop(dir, { stop_hook_active: true }), { env: {}, spawner });
    processHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p2', cwd: dir }, { env: {}, spawner });
    expect(calls).toHaveLength(0);
  });

  it('uses CLAUDE_PROJECT_DIR for the folder', () => {
    const dir = project('{"enabled":true}');
    const { calls, spawner } = recorder();
    processHook({ hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: '/elsewhere' }, { env: { CLAUDE_PROJECT_DIR: dir }, spawner });
    expect(calls[0]?.args[2]).toBe(dir);
  });

  it('survives a spawner that throws: one warning, no exception', () => {
    const dir = project('{"enabled":true}');
    const warnings: string[] = [];
    const spawner: AgentSpawner = () => { throw new Error('no spawn'); };
    const result = processHook(stop(dir), { env: {}, spawner, warn: (line) => warnings.push(line) });
    expect(result.spawned).toBe(false);
    expect(result.event?.id).toBe('s1:Stop:p1');
    expect(warnings).toEqual(['devlens hook: agent not started: no spawn']);
  });
});
