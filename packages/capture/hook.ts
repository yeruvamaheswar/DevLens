import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Event } from '../core/event';
import { handleHook, projectDirFrom } from './handle';

export type AgentSpawner = (command: string, args: string[], options: { detached: true; stdio: 'ignore' }) => { unref(): void };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX_CLI = path.join(HERE, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const AGENT_CLI = path.join(HERE, '..', 'agent', 'src', 'cli.ts');

// The agent's own `claude -p` call sets DEVLENS_AGENT=1. Its hooks must not capture it.
export function isAgentChild(env: Record<string, string | undefined>): boolean {
  return env.DEVLENS_AGENT === '1';
}

// Same rule as packages/agent/src/run.ts: on only when agent.json parses and enabled is true.
export function agentOptedIn(projectDir: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path.join(projectDir, '.devlens', 'agent.json'), 'utf8')) as { enabled?: unknown } | null;
    return parsed !== null && typeof parsed === 'object' && parsed.enabled === true;
  } catch {
    return false;
  }
}

// An async spawn failure arrives as an 'error' event; without a listener Node would exit 1.
const defaultSpawner: AgentSpawner = (command, args, options) => {
  const child = spawn(command, args, options);
  child.on('error', (error) => process.stderr.write(`devlens hook: agent not started: ${error.message}\n`));
  return child;
};

// Append the event first, then (Stop only, opt-in on) start the agent in the background.
export function processHook(
  input: unknown,
  options: { env?: Record<string, string | undefined>; eventsPath?: string; now?: Date; spawner?: AgentSpawner; warn?: (line: string) => void } = {},
): { event: Event | null; spawned: boolean } {
  const env = options.env ?? process.env;
  const event = handleHook(input, { env, eventsPath: options.eventsPath, now: options.now });
  const record = input as Record<string, unknown>;
  if (!event || event.payload.hook_event_name !== 'Stop' || record.hook_event_name !== 'Stop' || record.stop_hook_active === true) {
    return { event, spawned: false };
  }
  try {
    const projectDir = projectDirFrom(record, env);
    if (!agentOptedIn(projectDir)) return { event, spawned: false };
    const child = (options.spawner ?? defaultSpawner)(process.execPath, [TSX_CLI, AGENT_CLI, projectDir, event.session_id, event.id], { detached: true, stdio: 'ignore' });
    child.unref();
    return { event, spawned: true };
  } catch (error) {
    (options.warn ?? ((line) => process.stderr.write(`${line}\n`)))(`devlens hook: agent not started: ${error instanceof Error ? error.message : 'spawn failed'}`);
    return { event, spawned: false };
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && entry.replaceAll('\\', '/').endsWith('/packages/capture/hook.ts');
}

if (isDirectRun()) {
  if (isAgentChild(process.env)) process.exit(0);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('devlens hook: stdin was not JSON\n');
    process.exit(0);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stderr.write('devlens hook: payload was not an object\n');
    process.exit(0);
  }
  try {
    processHook(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'write failed';
    process.stderr.write(`devlens hook: ${message}\n`);
    process.exit(0);
  }
}
