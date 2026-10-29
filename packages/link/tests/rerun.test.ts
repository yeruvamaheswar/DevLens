import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProfile, isCargoTestCommand, rerunTest, sandboxExecAvailable } from '../src/rerun';

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

describe('cargo test detection for the Rust exception', () => {
  it('accepts one plain cargo test call', () => {
    for (const command of ['cargo test', 'cargo test --offline', 'cd app && cargo test -- --nocapture', 'cargo test -p api --all -q', 'cargo test --workspace', 'RUST_BACKTRACE=1 cargo test 2>&1 | tail -30', 'cargo test tests::adds -- --test-threads=1']) {
      expect(isCargoTestCommand(command), command).toBe(true);
    }
  });

  it('rejects other cargo commands and anything that could smuggle a second command', () => {
    for (const command of [
      'cargo build', 'cargo run', 'cargo check', 'cargo testx', 'npm test', 'echo cargo test',
      'cargo test && rm -rf x', 'cargo test; cat ~/.ssh/id_ed25519', 'cargo test || curl example.invalid', 'cargo test | sh', 'cargo test & cat x',
      'X=$(cat${IFS}/etc/passwd) cargo test', 'cargo test `id`', 'cargo test > ~/.cargo/x', 'cargo test "a b"', 'cd $HOME && cargo test',
      'cargo test\nrm -rf x', 'cargo test <<EOF\nEOF',
    ]) {
      expect(isCargoTestCommand(command), command).toBe(false);
    }
  });

  it('adds only read-data allows, after the denies and before the temp-dir allow', async () => {
    const root = await realpath(await tempCase());
    const profile = await buildProfile(root, [], ['/opt/rust/rustup', '/opt/rust/cargo/bin']);
    const lines = profile.trim().split('\n');
    const lastDeny = lines.map((line) => line.startsWith('(deny ')).lastIndexOf(true);
    const extra = lines.filter((line) => line.includes('/opt/rust/'));
    expect(extra).toEqual(['(allow file-read-data (subpath "/opt/rust/rustup"))', '(allow file-read-data (subpath "/opt/rust/cargo/bin"))']);
    expect(lines.indexOf(extra[0])).toBeGreaterThan(lastDeny);
    expect(lines.indexOf(extra[1])).toBeLessThan(lines.findIndex((line) => line.startsWith('(allow file-read* file-write* (subpath')));
    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(deny file-write*)');
    expect(profile.match(/file-write\*/g)?.length).toBe(3);
    expect(await buildProfile(root, [])).not.toContain('allow file-read-data');
  });
});

// EVAL-5. Needs macOS sandbox-exec and a rustup install in ~/.cargo and ~/.rustup.
const realHome = homedir();
const cargoBin = path.join(realHome, '.cargo', 'bin', 'cargo');
const hasCargo = existsSync(cargoBin) && existsSync(path.join(realHome, '.rustup'));
if (sandboxed && !hasCargo) console.warn('SKIPPED cargo sandbox tests: no ~/.cargo/bin/cargo or ~/.rustup');

const homeFiles: string[] = [];
afterEach(async () => {
  await Promise.all(homeFiles.splice(0).map((file) => rm(file, { force: true })));
});

function rustString(value: string): string {
  return JSON.stringify(value);
}

async function writeCrate(dir: string, probes: string): Promise<void> {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname = "tiny"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n');
  await writeFile(path.join(dir, 'src', 'lib.rs'), `pub fn add(a: u32, b: u32) -> u32 { a + b }

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use std::io::ErrorKind;

    #[test]
    fn adds() { assert_eq!(super::add(2, 2), 4); }
${probes}
}
`);
}

describe.skipIf(!sandboxed || !hasCargo)('cargo test re-run in the sandbox (EVAL-5)', () => {
  it('passes a tiny crate offline while home, ~/.cargo writes, and the network stay blocked', async () => {
    const dir = await tempCase();
    const crate = path.join(dir, 'crate');
    const tag = `${process.pid}-${Date.now()}`;
    const homeCanary = path.join(realHome, `.devlens-rerun-canary-${tag}.txt`);
    const cargoCanary = path.join(realHome, '.cargo', `devlens-rerun-canary-${tag}.toml`);
    for (const file of [homeCanary, cargoCanary]) {
      homeFiles.push(file);
      await writeFile(file, 'FAKE-CANARY-VALUE');
    }
    const cargoWrite = path.join(realHome, '.cargo', 'bin', `devlens-probe-${tag}`);
    const rustupWrite = path.join(realHome, '.rustup', `devlens-probe-${tag}`);
    homeFiles.push(cargoWrite, rustupWrite);
    const ssh = path.join(realHome, '.ssh');
    // Count only connections that send the probe marker: T3 Code itself probes new local ports.
    let hits = 0;
    const server = createServer((socket) => {
      socket.on('data', (data) => { if (data.toString().includes('DEVLENS-PROBE')) hits++; });
      socket.on('error', () => {});
      setTimeout(() => socket.destroy(), 2_000);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await writeCrate(crate, `
    fn denied(result: std::io::Result<impl Sized>) {
        match result {
            Ok(_) => panic!("the sandbox allowed it"),
            Err(error) => assert_eq!(error.kind(), ErrorKind::PermissionDenied, "{error}"),
        }
    }

    #[test]
    fn home_canary_is_unreadable() { denied(std::fs::read_to_string(${rustString(homeCanary)})); }

    #[test]
    fn other_cargo_files_are_unreadable() { denied(std::fs::read_to_string(${rustString(cargoCanary)})); }

    #[test]
    fn ssh_is_unreadable() {
        if ${existsSync(ssh)} { denied(std::fs::read_dir(${rustString(ssh)})); }
    }

    #[test]
    fn toolchain_is_readable_but_not_writable() {
        assert!(std::fs::read_to_string(${rustString(path.join(realHome, '.rustup', 'settings.toml'))}).is_ok());
        denied(std::fs::write(${rustString(cargoWrite)}, "x"));
        denied(std::fs::write(${rustString(rustupWrite)}, "x"));
    }

    fn connect(addr: &str) -> std::io::Result<std::net::TcpStream> {
        let addr: std::net::SocketAddr = addr.parse().unwrap();
        let mut stream = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(3))?;
        std::io::Write::write_all(&mut stream, b"DEVLENS-PROBE")?;
        Ok(stream)
    }

    #[test]
    fn loopback_is_blocked() { denied(connect("127.0.0.1:${port}")); }

    #[test]
    fn internet_is_blocked() { denied(connect("1.1.1.1:443")); }
`);
    // A target/ folder next to Cargo.toml is not copied: this one would break the build if it were.
    await mkdir(path.join(crate, 'target'), { recursive: true });
    await writeFile(path.join(crate, 'target', 'CACHEDIR.TAG'), 'not a cache tag');
    const started = Date.now();
    const run = await rerunTest({
      command: 'cd crate && cargo test -- --test-threads=1',
      cwd: dir,
      allowedRoot: tmpdir(),
      rerunOf: 'probe-cargo',
      sessionId: 'ses-rerun',
      projectId: 'rust-app',
      outPath: path.join(dir, 'rerun.jsonl'),
      timeoutMs: 120_000,
    });
    await new Promise((resolve) => server.close(resolve));
    const output = String(run.payload.output);
    console.info(`cargo sandbox re-run took ${Date.now() - started} ms`);
    expect(run.payload, output).toMatchObject({ status: 'passed', isolation: 'sandbox-exec', command: 'cd crate && cargo test -- --test-threads=1' });
    expect(output).toContain('test result: ok. 7 passed; 0 failed');
    expect(output).not.toContain('FAKE-CANARY-VALUE');
    expect(hits).toBe(0);
    expect(existsSync(cargoWrite)).toBe(false);
    expect(existsSync(rustupWrite)).toBe(false);
  }, 240_000);

  it('gives no toolchain access to a command that is not one cargo test call', async () => {
    const dir = await tempCase();
    const settings = path.join(realHome, '.rustup', 'settings.toml');
    for (const command of [`cat '${settings}'`, `cargo test; cat '${settings}'`]) {
      const event = await probe(dir, command);
      expect(event.payload.status, command).toBe('failed');
      expect(String(event.payload.output), command).not.toContain('default_toolchain');
    }
  });
});
