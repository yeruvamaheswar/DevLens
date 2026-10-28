import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EngineResult, QuestionEngine } from './types';

export const MODEL = 'claude-sonnet-5-5';
export const TIMEOUT_MS = 60_000;

export type SpawnOptions = { cwd: string; env: Record<string, string | undefined>; timeout: number; input: string };
export type Spawner = (file: string, args: string[], options: SpawnOptions) => Promise<{ stdout: string; stderr: string }>;

// No `--bare` (drops the login), no `--allowedTools`, no `--fallback-model` (breaks NOT-7), no `--add-dir`.
export function cliArgs(system: string): string[] {
  return [
    '-p', '--model', MODEL, '--tools', '', '--system-prompt', system,
    '--output-format', 'json', '--permission-prompts', 'none', '--strict-mcp-config',
    '--setting-sources', 'project', '--disable-slash-commands', '--no-session-persistence',
  ];
}

export const realSpawner: Spawner = (file, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, args, { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, timeout: options.timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const killed = (error as { killed?: boolean }).killed;
        reject(new Error(killed ? `timeout after ${options.timeout} ms` : `${error.message.split('\n')[0]} ${String(stderr).slice(0, 200)}`.trim()));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.on('error', () => { /* the process may exit before it reads */ });
    child.stdin?.end(options.input);
  });

function failure(route: QuestionEngine['route'], started: number, error: unknown): EngineResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error), route, model: MODEL, duration_ms: Date.now() - started };
}

export function createCliEngine(options: { spawner?: Spawner; env?: Record<string, string | undefined>; command?: string } = {}): QuestionEngine {
  const spawner = options.spawner ?? realSpawner;
  return {
    route: 'claude_cli',
    model: MODEL,
    async complete(system, user, timeout_ms) {
      const started = Date.now();
      let cwd: string | null = null;
      try {
        cwd = mkdtempSync(path.join(tmpdir(), 'devlens-agent-'));
        const { stdout } = await spawner(options.command ?? 'claude', cliArgs(system), { cwd, env: { ...(options.env ?? process.env), DEVLENS_AGENT: '1' }, timeout: timeout_ms, input: user });
        const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
        if (parsed.is_error === true) return failure('claude_cli', started, `claude reported an error: ${String(parsed.result ?? '').slice(0, 150)}`);
        if (typeof parsed.result !== 'string') return failure('claude_cli', started, 'claude output had no result text');
        return { ok: true, text: parsed.result, route: 'claude_cli', model: MODEL, duration_ms: Date.now() - started };
      } catch (error) {
        return failure('claude_cli', started, error);
      } finally {
        if (cwd) rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}

export function createApiEngine(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }): QuestionEngine {
  const base = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  return {
    route: 'anthropic_api',
    model: MODEL,
    async complete(system, user, timeout_ms) {
      const started = Date.now();
      try {
        // No tools, no fallbacks (NOT-7), no retries. max_tokens leaves room for adaptive thinking.
        const response = await doFetch(`${base}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
          signal: AbortSignal.timeout(timeout_ms),
        });
        const body = (await response.json().catch(() => null)) as { content?: { type: string; text?: string }[]; stop_reason?: string; error?: { message?: string } } | null;
        if (!response.ok) return failure('anthropic_api', started, `http ${response.status}: ${body?.error?.message ?? 'no detail'}`.slice(0, 200));
        if (body?.stop_reason === 'refusal') return failure('anthropic_api', started, 'model refused');
        const text = (body?.content ?? []).filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
        if (text.length === 0) return failure('anthropic_api', started, 'reply had no text');
        return { ok: true, text, route: 'anthropic_api', model: MODEL, duration_ms: Date.now() - started };
      } catch (error) {
        const name = (error as { name?: string }).name;
        return failure('anthropic_api', started, name === 'TimeoutError' || name === 'AbortError' ? `timeout after ${timeout_ms} ms` : error);
      }
    },
  };
}

export function selectEngine(env: Record<string, string | undefined>): QuestionEngine {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? createApiEngine({ apiKey: key }) : createCliEngine({ env });
}
