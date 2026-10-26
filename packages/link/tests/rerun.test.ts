import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { rerunTest, sandboxExecAvailable } from '../src/rerun';

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempCase(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'devlens-rerun-case-'));
  cleanups.push(dir);
  return dir;
}

const testSource = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpoint, token } from './client.js';
test('uses the correct base URL', () => {
  assert.equal(endpoint(), 'https://example.invalid/api/health');
});
test('sends a bearer token', () => {
  assert.ok(token().startsWith('Bearer '), 'missing bearer token');
});
`;

async function writeRepo(dir: string, tokenSource: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --test client.test.js' } }));
  await writeFile(path.join(dir, 'client.js'), `export const baseURL = 'https://example.invalid/api';
export function endpoint() { return \`\${baseURL}/health\`; }
export function token() { return ${tokenSource}; }
`);
  await writeFile(path.join(dir, 'client.test.js'), testSource);
}

async function runRepo(dir: string, rerunOf: string) {
  const outPath = path.join(dir, 'out', 'rerun.jsonl');
  const prefix = `devlens-rerun-${process.pid}-${rerunOf}-`;
  const event = await rerunTest({
    allowedRoot: tmpdir(),
    allowUnisolated: true,
    command: 'npm test',
    cwd: dir,
    rerunOf,
    sessionId: 'ses-rerun',
    projectId: 'broken-api',
    outPath,
    timeoutMs: 20_000,
    tempPrefix: prefix,
  });
  const names = await readdir(tmpdir());
  expect(names.some((name) => name.startsWith(prefix))).toBe(false);
  const stored = (await readFile(outPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { source: string; provenance: string; payload: { status: string; signal: string; rerun_of: string } });
  expect(stored.at(-1)).toMatchObject({ source: 'sandbox', provenance: 'observed', payload: { signal: 'rerun', rerun_of: rerunOf } });
  return event;
}

describe('sandbox re-run', () => {
  it('fails the first-fix repo and passes the final-fix repo', async () => {
    const first = await tempCase();
    await writeRepo(first, "''");
    const failed = await runRepo(first, 'session-fail');
    expect(failed).toMatchObject({
      actor: 'ci',
      type: 'test',
      source: 'sandbox',
      provenance: 'observed',
      payload: { status: 'failed', command: 'npm test', signal: 'rerun', rerun_of: 'session-fail' },
    });
    expect(String(failed.payload.output)).toContain('missing bearer token');
    expect(String(failed.payload.output)).toContain('✔ uses the correct base URL');

    const finalDir = await tempCase();
    await writeRepo(finalDir, "'Bearer demo'");
    const passed = await runRepo(finalDir, 'session-pass');
    expect(passed.payload.status).toBe('passed');
    expect(String(passed.payload.output)).toContain('ℹ pass 2');
    expect(passed.source).toBe('sandbox');
    expect(passed.provenance).toBe('observed');
  }, 30_000);

  it('kills a hanging command at the wall-clock timeout', async () => {
    const dir = await tempCase();
    await writeFile(path.join(dir, 'package.json'), '{"private":true}\n');
    const prefix = `devlens-rerun-hang-${process.pid}-`;
    const started = Date.now();
    const event = await rerunTest({
    allowedRoot: tmpdir(),
    allowUnisolated: true,
      command: 'node -e "setInterval(() => {}, 1000)"',
      cwd: dir,
      rerunOf: 'session-hang',
      sessionId: 'ses-rerun',
      projectId: 'broken-api',
      outPath: path.join(dir, 'rerun.jsonl'),
      timeoutMs: 400,
      tempPrefix: prefix,
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(event.payload.status).toBe('failed');
    expect(event.source).toBe('sandbox');
    const names = await readdir(tmpdir());
    expect(names.some((name) => name.startsWith(prefix))).toBe(false);
  });

  it('caps stored output', async () => {
    const dir = await tempCase();
    const event = await rerunTest({
    allowedRoot: tmpdir(),
    allowUnisolated: true,
      command: "node -e \"process.stdout.write('Z'.repeat(20000))\"",
      cwd: dir,
      rerunOf: 'session-cap',
      sessionId: 'ses-rerun',
      projectId: 'broken-api',
      outPath: path.join(dir, 'rerun.jsonl'),
      timeoutMs: 5_000,
      maxOutputBytes: 100,
    });
    expect(Buffer.byteLength(String(event.payload.output))).toBeLessThanOrEqual(100);
    expect(String(event.payload.output).length).toBeGreaterThan(0);
  });

  it('hides planted Supabase and Anthropic keys from the child', async () => {
    const dir = await tempCase();
    const plantedSupabase = 'planted-supabase-value';
    const plantedAnthropic = 'planted-anthropic-value';
    const event = await rerunTest({
    allowedRoot: tmpdir(),
    allowUnisolated: true,
      command: "node -e \"if(process.env.SUPABASE_SECRET_KEY||process.env.ANTHROPIC_API_KEY){process.stdout.write('visible');process.exit(1)} process.stdout.write('hidden')\"",
      cwd: dir,
      rerunOf: 'session-env',
      sessionId: 'ses-rerun',
      projectId: 'broken-api',
      outPath: path.join(dir, 'rerun.jsonl'),
      timeoutMs: 5_000,
      parentEnv: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        SUPABASE_SECRET_KEY: plantedSupabase,
        ANTHROPIC_API_KEY: plantedAnthropic,
      },
    });
    const output = String(event.payload.output);
    expect(output).toContain('hidden');
    expect(output.includes('visible')).toBe(false);
    expect(output.includes(plantedSupabase)).toBe(false);
    expect(output.includes(plantedAnthropic)).toBe(false);
    expect(await readFile(path.join(dir, 'touched.txt'), 'utf8').catch(() => '')).toBe('');
  });

  it('writes the marker in the temp copy and deletes that copy', async () => {
    const dir = await tempCase();
    const prefix = `devlens-rerun-copy-${process.pid}-`;
    await rerunTest({
    allowedRoot: tmpdir(),
    allowUnisolated: true,
      command: "node -e \"require('node:fs').writeFileSync('touched.txt','x')\"",
      cwd: dir,
      rerunOf: 'session-copy',
      sessionId: 'ses-rerun',
      projectId: 'broken-api',
      outPath: path.join(dir, 'rerun.jsonl'),
      timeoutMs: 5_000,
      tempPrefix: prefix,
    });
    await expect(readFile(path.join(dir, 'touched.txt'), 'utf8')).rejects.toThrow();
    const names = await readdir(tmpdir());
    expect(names.some((name) => name.startsWith(prefix))).toBe(false);
  });
});

// Review probes F3/F4. Canaries are fake strings in temp dirs outside the target.
const sandboxed = sandboxExecAvailable();
if (!sandboxed) console.warn('SKIPPED sandbox boundary tests: sandbox-exec is unavailable on this platform');

async function canary(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'devlens-canary-'));
  cleanups.push(dir);
  const file = path.join(dir, 'outside.txt');
  await writeFile(file, 'FAKE-CANARY-VALUE');
  return { dir, file };
}

async function probe(dir: string, command: string, extra: { cwd?: string; allowedRoot?: string; timeoutMs?: number } = {}) {
  return rerunTest({
    command,
    cwd: extra.cwd ?? dir,
    allowedRoot: extra.allowedRoot ?? tmpdir(),
    allowUnisolated: true,
    rerunOf: 'probe',
    sessionId: 'ses-rerun',
    projectId: 'broken-api',
    outPath: path.join(dir, 'rerun.jsonl'),
    timeoutMs: extra.timeoutMs ?? 5_000,
  });
}

describe.skipIf(!sandboxed)('sandbox-exec boundary', () => {
  it('records isolation and still runs a plain command', async () => {
    const dir = await tempCase();
    const event = await probe(dir, 'echo ok');
    expect(event.payload).toMatchObject({ status: 'passed', isolation: 'sandbox-exec' });
  });

  it('blocks an absolute-path read of a file outside the copy', async () => {
    const dir = await tempCase();
    const { file } = await canary();
    const event = await probe(dir, `cat '${file}'`);
    expect(event.payload.status).toBe('failed');
    expect(String(event.payload.output)).not.toContain('FAKE-CANARY-VALUE');
  });

  it('blocks a relative ".." read of a file outside the copy', async () => {
    const dir = await tempCase();
    const { file } = await canary();
    const event = await probe(dir, `cat '${'../'.repeat(12)}${file.replace(/^\//, '')}'`);
    expect(event.payload.status).toBe('failed');
    expect(String(event.payload.output)).not.toContain('FAKE-CANARY-VALUE');
  });

  it('blocks reads of the repo and writes outside the copy', async () => {
    const dir = await tempCase();
    const { dir: other } = await canary();
    const repoPackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json');
    const read = await probe(dir, `cat '${repoPackage}'`);
    expect(read.payload.status).toBe('failed');
    expect(String(read.payload.output)).not.toContain('"devlens"');
    const write = await probe(dir, `echo x > '${path.join(other, 'written.txt')}'`);
    expect(write.payload.status).toBe('failed');
    expect(await readFile(path.join(other, 'written.txt'), 'utf8').catch(() => 'absent')).toBe('absent');
  });

  it('blocks network connections', async () => {
    const dir = await tempCase();
    let hits = 0;
    const server = createServer((socket) => { hits++; socket.destroy(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const event = await probe(dir, `node -e "require('node:net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(3))"`);
      expect(event.payload.status).toBe('failed');
      expect(hits).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('target validation', () => {
  it('rejects a target with ".." segments', async () => {
    const dir = await tempCase();
    await mkdir(path.join(dir, 'a'));
    await expect(probe(dir, 'true', { cwd: `${dir}/a/..`, allowedRoot: dir })).rejects.toThrow(/\.\./);
    await expect(probe(dir, 'true', { cwd: `${dir}/a/../..`, allowedRoot: dir })).rejects.toThrow(/\.\./);
  });

  it('rejects an absolute target outside the allowed root', async () => {
    const dir = await tempCase();
    const { dir: other } = await canary();
    await expect(probe(dir, 'cat outside.txt', { cwd: other, allowedRoot: dir })).rejects.toThrow(/outside the allowed root/);
  });

  it('rejects a symlink as the target root', async () => {
    const dir = await tempCase();
    const { dir: other } = await canary();
    const link = path.join(dir, 'link');
    await symlink(other, link);
    await expect(probe(dir, 'cat outside.txt', { cwd: link, allowedRoot: dir })).rejects.toThrow(/symlink/);
  });
});

describe('process cleanup', () => {
  it('kills a background child that outlives its parent', async () => {
    const dir = await tempCase();
    const script = "const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('pid='+c.pid);c.unref()";
    const event = await probe(dir, `node -e "${script}"`);
    const pid = Number(/pid=(\d+)/.exec(String(event.payload.output))?.[1]);
    expect(pid).toBeGreaterThan(0);
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  });
});
