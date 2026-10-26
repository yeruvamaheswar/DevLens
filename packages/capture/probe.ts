import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { init } from '../cli/src/init';

const marker = 'sk-probe-FAKE-not-real-0001';
const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
}

function scrub(text: string): string {
  return text.split(marker).join('[marker]');
}

function settingsSnapshot(dir: string): string {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith('settings')).sort();
  } catch {
    return 'missing';
  }
  return names.map((name) => {
    const body = readFileSync(path.join(dir, name));
    return `${name}:${createHash('sha256').update(body).digest('hex')}`;
  }).join('|');
}

function readEvents(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function runClaude(cwd: string, prompt: string): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(npm test)'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function writeProject(dir: string): void {
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'devlens-hook-probe',
    private: true,
    type: 'module',
    scripts: { test: 'node --test test.mjs' },
  }, null, 2)}\n`);
  writeFileSync(path.join(dir, 'lib.mjs'), 'export function add(a, b) {\n  return a - b;\n}\n');
  writeFileSync(path.join(dir, 'test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from './lib.mjs';",
    "test('adds', () => { assert.equal(add(1, 2), 3); });",
    '',
  ].join('\n'));
}

function assertEvents(events: Record<string, unknown>[], fileText: string): void {
  check(events.length > 0, 'jsonl has at least one event');
  check(events.every((event) => typeof event.session_id === 'string' && event.session_id !== 'unknown'), 'every event has a supplied session_id');
  check(events.some((event) => typeof event.tool_use_id === 'string' && event.tool_use_id.length > 0), 'a tool event keeps the supplied tool_use_id');
  check(events.some((event) => event.type === 'test'), 'jsonl has a test event');
  check(!fileText.includes(marker), 'fake sk- marker is absent from the written file');
  const prompt = events.find((event) => event.type === 'prompt');
  check(prompt?.tool_use_id === null, 'prompt tool_use_id stays null when the hook omits it');
  const testEvent = events.find((event) => event.type === 'test');
  const payload = testEvent?.payload;
  const hasExit = payload !== null && typeof payload === 'object' && 'exit_code' in payload;
  check(testEvent !== undefined && !hasExit, 'test event does not invent exit_code');
}

async function main(): Promise<void> {
  const homeClaude = path.join(homedir(), '.claude');
  const beforeHome = settingsSnapshot(homeClaude);
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-hook-probe-'));
  console.log(`probe dir: ${dir}`);
  writeProject(dir);
  init(dir);
  const settingsFile = path.join(dir, '.claude', 'settings.local.json');
  check(existsSync(settingsFile), 'init wrote project-local settings.local.json');
  const eventsFile = path.join(dir, '.devlens', 'events.jsonl');
  const prompts = [
    `Run npm test. Fix lib.mjs so add(1, 2) returns 3. Run npm test again. This string is not a credential: ${marker}`,
    `Run npm test once, then stop. This string is not a credential: ${marker}`,
  ];
  let claudeRuns = 0;
  for (const prompt of prompts) {
    if (claudeRuns >= 2) break;
    claudeRuns += 1;
    const result = await runClaude(dir, prompt);
    console.log(`claude run ${claudeRuns}: exit ${result.code ?? 'none'}`);
    if (result.error) {
      console.log(`NOT_RUN: claude -p cannot run: ${scrub(result.error)}`);
      check(settingsSnapshot(homeClaude) === beforeHome, 'user Claude settings were not modified');
      process.exit(1);
    }
    if (result.stderr.trim()) console.log(`claude stderr: ${scrub(result.stderr).slice(0, 500)}`);
    const events = readEvents(eventsFile);
    const fileText = existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8') : '';
    if (events.some((event) => event.type === 'test')) {
      assertEvents(events, fileText);
      break;
    }
    if (claudeRuns === 2) {
      const reason = scrub(`${result.stderr}\n${result.stdout}`).slice(0, 500);
      if (events.length === 0) console.log(`NOT_RUN: claude -p produced no hook events. ${reason}`);
      assertEvents(events, fileText);
    }
  }
  check(settingsSnapshot(homeClaude) === beforeHome, 'user Claude settings were not modified');
  if (failures.length > 0) {
    console.log(`FAIL ${failures.length} assertion(s)`);
    process.exit(1);
  }
  console.log('PASS probe');
}

main().catch((error) => {
  console.log(`NOT_RUN: ${error instanceof Error ? error.message : 'probe failed'}`);
  process.exit(1);
});
