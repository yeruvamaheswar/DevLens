import path from 'node:path';
import type { Event } from '../core/event';
import { appendEvent } from './append-event';
import { mapHook, type HookInput } from './map-hook';
import { redactStreamPair, redactValue, secretValuesFromEnv, shortSecretValuesFromEnv } from './redact';

function isRecord(value: unknown): value is HookInput {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function projectDirFrom(input: HookInput, env: Record<string, string | undefined>): string {
  if (typeof env.CLAUDE_PROJECT_DIR === 'string' && env.CLAUDE_PROJECT_DIR.length > 0) return env.CLAUDE_PROJECT_DIR;
  if (typeof input.cwd === 'string' && input.cwd.length > 0) return input.cwd;
  return process.cwd();
}

export function projectIdFromDir(dir: string): string {
  const base = path.basename(path.resolve(dir));
  return base.length > 0 ? base : 'unknown';
}

export function eventsPathFor(projectDir: string): string {
  return path.join(projectDir, '.devlens', 'events.jsonl');
}

export function stampTs(now = new Date()): string {
  return now.toISOString();
}

function maskSplitStreams(input: HookInput, secrets: readonly string[], shorts: readonly string[]): HookInput {
  const response = input.tool_response;
  if (!isRecord(response) || typeof response.stdout !== 'string' || typeof response.stderr !== 'string') return input;
  const [stdoutHead, stderrTail] = redactStreamPair(response.stdout, response.stderr, secrets, shorts);
  const [stderrHead, stdoutTail] = redactStreamPair(stderrTail, stdoutHead, secrets, shorts);
  return { ...input, tool_response: { ...response, stdout: stdoutTail, stderr: stderrHead } };
}

export function handleHook(input: unknown, options: { eventsPath?: string; env?: Record<string, string | undefined>; now?: Date } = {}): Event | null {
  if (!isRecord(input)) return null;
  const env = options.env ?? process.env;
  const secrets = secretValuesFromEnv(env);
  const shorts = shortSecretValuesFromEnv(env);
  const projectDir = projectDirFrom(input, env);
  const mapped = mapHook(maskSplitStreams(input, secrets, shorts), stampTs(options.now), projectIdFromDir(projectDir));
  if (!mapped) return null;
  const redacted = redactValue(mapped, secrets, shorts);
  return appendEvent(options.eventsPath ?? eventsPathFor(projectDir), redacted);
}
