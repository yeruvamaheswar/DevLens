import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SessionEnd',
] as const;

export const CONSENT_NOTICE = [
  'Notice the candidate sees',
  '',
  'Captured:',
  '',
  '- The window the developer picks',
  '- Prompts, tool calls, diffs, and command output',
  '- Test results',
  '- The typed answer to a DevLens question',
  '',
  'Not captured:',
  '',
  '- Camera',
  '- Microphone',
  '- The whole desktop',
  '- A score',
  '',
  'The developer can pause, stop, play the file, delete it, and hide a line before export. Declining capture is allowed. This demo records a teammate only. Do not record anyone else.',
].join('\n');

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');
export const hookScript = path.join(repoRoot, 'packages', 'capture', 'hook.ts');
export const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

type HookHandler = { type?: string; command?: string; args?: string[]; [key: string]: unknown };
type MatcherGroup = { matcher?: string; hooks?: HookHandler[]; [key: string]: unknown };
type Settings = { hooks?: Record<string, unknown>; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function devlensHookHandler(): HookHandler {
  return { type: 'command', command: process.execPath, args: [tsxCli, hookScript] };
}

export function isDevlensHandler(handler: HookHandler): boolean {
  const args = Array.isArray(handler.args) ? handler.args.map(String) : [];
  if (args.some((arg) => arg === hookScript || arg.endsWith(`${path.sep}packages${path.sep}capture${path.sep}hook.ts`) || arg.endsWith('/packages/capture/hook.ts'))) return true;
  return typeof handler.command === 'string' && handler.command.includes('packages/capture/hook.ts');
}

function settingsPathFor(dir: string): string {
  return path.resolve(dir, '.claude', 'settings.local.json');
}

function assertProjectLocal(settingsPath: string): void {
  const homeClaude = path.resolve(homedir(), '.claude');
  const resolved = path.resolve(settingsPath);
  if (resolved === homeClaude || resolved.startsWith(homeClaude + path.sep)) {
    throw new Error('devlens init refuses to write user-global Claude settings');
  }
}

function readSettings(file: string): Settings {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8').trim();
  if (text.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`devlens init: ${file} is not JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`devlens init: ${file} must be a JSON object`);
  return parsed;
}

function groupsOf(value: unknown, eventName: string, file: string): MatcherGroup[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`devlens init: ${file} hooks.${eventName} must be an array`);
  return value.map((group) => {
    if (!isRecord(group)) throw new Error(`devlens init: ${file} hooks.${eventName} has a non-object group`);
    return group as MatcherGroup;
  });
}

function withoutDevlens(groups: MatcherGroup[]): MatcherGroup[] {
  const kept: MatcherGroup[] = [];
  for (const group of groups) {
    const original = group.hooks ?? [];
    const hooks = original.filter((handler) => !isDevlensHandler(handler));
    const removed = hooks.length !== original.length;
    if (removed && hooks.length === 0 && Object.keys(group).every((key) => key === 'hooks' || key === 'matcher')) continue;
    kept.push(removed ? { ...group, hooks } : group);
  }
  return kept;
}

export function installHooks(dir: string): string {
  if (!existsSync(tsxCli) || !existsSync(hookScript)) {
    throw new Error('devlens init: hook runtime is missing (packages/capture/hook.ts or tsx)');
  }
  const file = settingsPathFor(dir);
  assertProjectLocal(file);
  const settings = readSettings(file);
  if (settings.hooks !== undefined && !isRecord(settings.hooks)) {
    throw new Error(`devlens init: ${file} hooks must be an object`);
  }
  const hooks: Record<string, unknown> = { ...(settings.hooks ?? {}) };
  const handler = devlensHookHandler();
  for (const eventName of HOOK_EVENTS) {
    const groups = withoutDevlens(groupsOf(hooks[eventName], eventName, file));
    groups.push({ hooks: [handler] });
    hooks[eventName] = groups;
  }
  settings.hooks = hooks;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return file;
}

export function init(dir: string, out: (line: string) => void = (line) => console.log(line)): string {
  out(CONSENT_NOTICE);
  return installHooks(dir);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && entry.replaceAll('\\', '/').endsWith('/packages/cli/src/init.ts');
}

if (isDirectRun()) {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write('usage: devlens init <dir>\n');
    process.exit(1);
  }
  try {
    init(dir);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'devlens init failed'}\n`);
    process.exit(1);
  }
}
