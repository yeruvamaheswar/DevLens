import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, appendFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Event, TestPayload } from '../../core/event';

// Threat model (honest): this stops accidental leakage and casual reads, writes, or network calls
// made by the project's own test code. It is NOT a defence against hostile native code or a
// macOS sandbox escape. The child gets a scrubbed env allowlist and a temp copy of the target.
//
// Boundary, per run:
//   - The target must be a real directory under an allowed root. A symlink root or a '..' segment is rejected.
//   - The tree is copied to a temp dir. Symlinks and .env* files are not copied.
//   - macOS sandbox-exec runs the command with a generated profile: no network, no file writes
//     outside the temp dir, no reads of the home dir, the repo, the tmp roots, or the allowed root.
//   - Without sandbox-exec the run is refused unless the caller passes allowUnisolated.
//   - Rust exception, only when the command is one `cargo test` call (isCargoTestCommand): read-only
//     ~/.rustup, ~/.cargo/bin, ~/.cargo/registry/{index,cache} and ~/.cargo/git/db. Nothing else in ~/.cargo
//     (credentials.toml, config.toml) and no write to either. CARGO_HOME, the registry src folder, git
//     checkouts and the target dir live in the temp dir; CARGO_NET_OFFLINE=true. Network stays denied.
//
// Process cleanup: the child runs in its own process group. On every completion path (exit, timeout,
// error) the whole group gets SIGKILL and we wait until the group is gone before the temp dir is removed.
// Limit: a descendant that calls setsid (or node's detached:true) leaves the group and is not killed.

const DEFAULT_TIMEOUT_MS = 30_000;
// A cargo re-run compiles every dependency from the registry cache (the checkout's target/ is not copied).
const DEFAULT_CARGO_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 32_768;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

type ParentEnv = Readonly<Record<string, string | undefined>>;

export type RerunRequest = {
  command: string;
  cwd: string;
  allowedRoot: string;
  rerunOf: string;
  sessionId: string;
  projectId: string;
  outPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  parentEnv?: ParentEnv;
  tempPrefix?: string;
  allowUnisolated?: boolean;
};

type RunResult = { code: number | null; output: string; timedOut: boolean; started: boolean };

export function sandboxExecAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC);
}

function secretName(key: string): boolean {
  if (key.startsWith('SUPABASE_') || key.startsWith('ANTHROPIC_') || key.startsWith('NEXT_PUBLIC_')) return true;
  if (key === 'PATH' || key === 'LANG' || key === 'LC_ALL') return false;
  return /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i.test(key);
}

export function sandboxEnv(parent: ParentEnv, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    TMPDIR: home,
    LANG: 'C',
    NODE_ENV: 'test',
    npm_config_cache: path.join(home, '.npm'),
    npm_config_update_notifier: 'false',
  };
  const pathValue = parent.PATH;
  if (typeof pathValue === 'string' && pathValue.length > 0) env.PATH = pathValue;
  const lang = parent.LANG;
  if (typeof lang === 'string' && lang.length > 0 && !secretName('LANG')) env.LANG = lang;
  const locale = parent.LC_ALL;
  if (typeof locale === 'string' && locale.length > 0 && !secretName('LC_ALL')) env.LC_ALL = locale;
  for (const key of Object.keys(env)) {
    if (secretName(key)) delete env[key];
  }
  return env;
}

// Returns the real path of the target, or throws. Does not follow a symlink root.
export async function resolveTarget(cwd: string, allowedRoot: string): Promise<string> {
  if (!cwd) throw new Error('rerun needs a target directory');
  if (cwd.split(/[\\/]+/).includes('..')) throw new Error('rerun target must not contain ".."');
  const absolute = path.resolve(cwd);
  const info = await lstat(absolute).catch(() => null);
  if (!info) throw new Error('rerun target does not exist');
  if (info.isSymbolicLink()) throw new Error('rerun target must not be a symlink');
  if (!info.isDirectory()) throw new Error('rerun target must be a directory');
  const real = await realpath(absolute);
  const rootReal = await realpath(path.resolve(allowedRoot)).catch(() => null);
  if (!rootReal) throw new Error('rerun allowed root does not exist');
  const rel = path.relative(rootReal, real);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('rerun target is outside the allowed root');
  return real;
}

function skipCopy(name: string): boolean {
  return name === 'node_modules' || name === '.git' || name === '.devlens' || name === '.env' || name.startsWith('.env.');
}

// skipCargoTarget: leave out a `target` folder that sits next to a Cargo.toml. Cargo rebuilds it in the temp dir.
async function copyTree(src: string, dest: string, skipCargoTarget = false): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  const crate = skipCargoTarget && entries.some((entry) => entry.isFile() && entry.name === 'Cargo.toml');
  for (const entry of entries) {
    if (skipCopy(entry.name) || entry.isSymbolicLink()) continue;
    if (crate && entry.name === 'target' && entry.isDirectory()) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, skipCargoTarget);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

// Same strictness as the T3 importer's test detection, and stricter about shell syntax: apart from `cd`
// steps, env assignments, and an output tail such as `2>&1 | tail -20`, the command is one `cargo test` call
// whose words hold no quotes, substitutions, or redirects. Only such a command gets the Rust read exception.
const SAFE_WORD = /^[\w@%+=:,./-]+$/;
const CARGO_TAIL = /\s*(?:2>&1\s*)?(?:\|\s*(?:tail|head|cat)(?:\s+-?\w+)*\s*)*$/;
const CD_STEP = /^cd\s+[\w@%+=:,./-]+$/;
export function isCargoTestCommand(command: string): boolean {
  const body = command.replace(CARGO_TAIL, '');
  if (/[\n\r`$<>()'"\\{}*?[\]!~#]/.test(body)) return false;
  // Steps join only with `&&` or `;`. A single `&` or `|` anywhere else could start a second command.
  if (/[&|]/.test(body.replace(/&&/g, ';'))) return false;
  const steps = body.split(/&&|;/).map((step) => step.trim()).filter(Boolean);
  if (steps.some((step) => /^cd(?:\s|$)/.test(step) && !CD_STEP.test(step))) return false;
  const work = steps.filter((step) => !CD_STEP.test(step));
  if (work.length !== 1) return false;
  const words = work[0].trim().split(/\s+/);
  while (words.length > 0 && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) words.shift();
  return words[0] === 'cargo' && words[1] === 'test' && words.every((word) => SAFE_WORD.test(word));
}

type CargoAccess = { readOnly: string[]; env: Record<string, string>; path: string[] };

// Inside the sandbox, xcrun cannot write its lookup cache (a per-user temp folder), so every `cc` call
// does a slow full lookup and prints an error. Resolving the SDK and the compiler folder here, outside the
// sandbox, took a serde crate's re-run from 21 s to 4 s. Speed only: without it the run still works.
function xcodeTools(): { sdk: string; bin: string } | null {
  if (process.platform !== 'darwin') return null;
  try {
    const ask = (args: string[]) => execFileSync('/usr/bin/xcrun', args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const sdk = ask(['--show-sdk-path']);
    const cc = ask(['-f', 'cc']);
    return path.isAbsolute(sdk) && path.isAbsolute(cc) ? { sdk, bin: path.dirname(cc) } : null;
  } catch {
    return null; // No Xcode tools: rustc falls back to xcrun inside the sandbox (slower).
  }
}

// Builds the temp CARGO_HOME: registry index and cache, and git db, are symlinks to the real read-only
// folders. registry/src, git/checkouts, the package-cache lock, and the target dir are temp folders.
async function cargoAccess(root: string): Promise<CargoAccess> {
  const home = homedir();
  const rustupHome = await realOrNull(path.join(home, '.rustup'));
  const cargoReal = await realOrNull(path.join(home, '.cargo'));
  const cargoHome = path.join(root, 'cargo-home');
  await mkdir(path.join(cargoHome, 'registry', 'src'), { recursive: true });
  await mkdir(path.join(cargoHome, 'git', 'checkouts'), { recursive: true });
  const readOnly: string[] = [];
  if (rustupHome) readOnly.push(rustupHome);
  const bin = cargoReal ? await realOrNull(path.join(cargoReal, 'bin')) : null;
  if (bin) readOnly.push(bin);
  // Registry index and cache: crates.io only, so crates from a private registry stay unreadable (review finding 3).
  for (const shared of ['registry/index', 'registry/cache']) {
    const real = cargoReal ? await realOrNull(path.join(cargoReal, shared)) : null;
    if (!real) continue;
    await mkdir(path.join(cargoHome, shared), { recursive: true });
    for (const entry of await readdir(real, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('index.crates.io-')) continue;
      const source = await realOrNull(path.join(real, entry.name));
      if (!source) continue;
      readOnly.push(source);
      await symlink(source, path.join(cargoHome, shared, entry.name));
    }
  }
  // Git dependencies: the whole git db is readable (it may hold private repositories; see the README).
  const gitDb = cargoReal ? await realOrNull(path.join(cargoReal, 'git/db')) : null;
  if (gitDb) {
    readOnly.push(gitDb);
    await symlink(gitDb, path.join(cargoHome, 'git/db'));
  }
  // A read-only path must never cover the home folder, the repo, or the run (for example a symlinked ~/.cargo).
  const guarded = [home, await realOrNull(home), repoRoot, await realOrNull(repoRoot), root].filter((p): p is string => p !== null);
  if (readOnly.some((dir) => guarded.some((p) => p === dir || p.startsWith(`${dir}${path.sep}`)))) {
    throw new Error('rerun refused: a Rust toolchain folder resolves to a place the sandbox must not read');
  }
  const env: Record<string, string> = {
    CARGO_HOME: cargoHome,
    CARGO_TARGET_DIR: path.join(root, 'cargo-target'),
    CARGO_NET_OFFLINE: 'true',
  };
  if (rustupHome) env.RUSTUP_HOME = rustupHome;
  const xcode = xcodeTools();
  if (xcode) env.SDKROOT = xcode.sdk;
  return { readOnly, env, path: [bin, xcode?.bin ?? null].filter((dir): dir is string => dir !== null) };
}

function sbString(value: string): string {
  if (/["\\\n]/.test(value)) throw new Error('rerun path has characters the sandbox profile cannot hold');
  return `"${value}"`;
}

async function realOrNull(p: string): Promise<string | null> {
  try { return await realpath(p); } catch { return null; }
}

// Later rules win in a sandbox profile, so the run's temp dir is allowed last.
// Only file-read-data is denied: node must lstat the parents of its cwd (metadata, such as file names
// existing, stays visible; contents and directory listings do not).
// readOnly: real paths the run may read but not write (the Rust exception). They are allowed after the denies.
// file-read-data, not file-read*: on this macOS an `allow file-read*` does not override a `deny file-read-data`.
export async function buildProfile(tempRoot: string, extraDeny: readonly string[], readOnly: readonly string[] = []): Promise<string> {
  const denyRaw = [homedir(), repoRoot, tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', ...extraDeny];
  const deny = new Set<string>();
  for (const raw of denyRaw) {
    deny.add(path.resolve(raw));
    const real = await realOrNull(raw);
    if (real) deny.add(real);
  }
  // getcwd lists the parent directories of the cwd. Where a denied root contains the temp dir, the run's
  // own ancestor directories stay listable (names only). The temp dir itself is carved out of the deny.
  const ancestors: string[] = [];
  for (let dir = path.dirname(tempRoot); dir !== path.dirname(dir); dir = path.dirname(dir)) ancestors.push(dir);
  const denyRule = (p: string): string => {
    const inside = tempRoot === p || tempRoot.startsWith(`${p}${path.sep}`);
    if (!inside) return `(deny file-read-data (subpath ${sbString(p)}))`;
    const keep = ancestors.filter((a) => a === p || a.startsWith(`${p}${path.sep}`)).map((a) => `(require-not (literal ${sbString(a)}))`);
    return `(deny file-read-data (require-all (subpath ${sbString(p)}) ${keep.join(' ')} (require-not (subpath ${sbString(tempRoot)}))))`;
  };
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    ...[...deny].map(denyRule),
    ...readOnly.map((p) => `(allow file-read-data (subpath ${sbString(p)}))`),
    `(allow file-read* file-write* (subpath ${sbString(tempRoot)}))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
  ];
  return `${lines.join('\n')}\n`;
}

function killGroup(pid: number | undefined): void {
  if (pid == null) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* The group already exited. */ }
}

async function groupGone(pid: number | undefined, waitMs: number): Promise<void> {
  if (pid == null) return;
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try { process.kill(-pid, 0); } catch { return; }
    killGroup(pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function runBounded(file: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, maxOutputBytes: number): Promise<RunResult> {
  const child = spawn(file, [...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  let received = 0;
  let timedOut = false;
  let started = true;
  let code: number | null = null;
  const take = (chunk: Buffer) => {
    if (received >= maxOutputBytes) return;
    const slice = chunk.subarray(0, maxOutputBytes - received);
    chunks.push(slice);
    received += slice.length;
  };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  const exited = new Promise<void>((resolve) => {
    child.on('error', () => { started = false; resolve(); });
    child.on('exit', (exitCode) => { code = exitCode; resolve(); });
  });
  const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
  const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, timeoutMs);
  await exited;
  clearTimeout(timer);
  // Every path: kill the whole group, then wait for it and for the pipes to close.
  killGroup(child.pid);
  await groupGone(child.pid, 3000);
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
  child.stdout?.destroy();
  child.stderr?.destroy();
  return { code, output: Buffer.concat(chunks).toString('utf8'), timedOut, started };
}

async function nextSeq(outPath: string): Promise<number> {
  try {
    const text = await readFile(outPath, 'utf8');
    return text.split('\n').filter((line) => line.trim().length > 0).length + 1;
  } catch {
    return 1;
  }
}

function runStatus(result: RunResult): TestPayload['status'] {
  if (!result.started) return 'unknown';
  if (result.timedOut || result.code !== 0) return 'failed';
  return 'passed';
}

export async function rerunTest(request: RerunRequest): Promise<Event> {
  const command = request.command.trim();
  if (!command) throw new Error('rerun needs a command');
  if (!request.rerunOf) throw new Error('rerun needs a session test event id');
  if (!request.sessionId || !request.projectId) throw new Error('rerun needs a session and a project');
  if (!request.allowedRoot) throw new Error('rerun needs an allowed root');
  const cargo = isCargoTestCommand(command);
  const timeoutMs = request.timeoutMs ?? (cargo ? DEFAULT_CARGO_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (timeoutMs <= 0 || maxOutputBytes <= 0) throw new Error('rerun bounds must be positive');
  const isolated = sandboxExecAvailable();
  if (!isolated && !request.allowUnisolated) {
    throw new Error('rerun refused: sandbox-exec is unavailable; pass allowUnisolated (--unsafe-no-isolation) to run without isolation');
  }
  const target = await resolveTarget(request.cwd, request.allowedRoot);
  const root = await realpath(await mkdtemp(path.join(tmpdir(), request.tempPrefix ?? 'devlens-rerun-')));
  try {
    const home = path.join(root, 'home');
    const work = path.join(root, 'work');
    await mkdir(home);
    await copyTree(target, work, cargo);
    const env = sandboxEnv(request.parentEnv ?? process.env, home);
    const rust = cargo && isolated ? await cargoAccess(root) : null;
    if (rust) {
      Object.assign(env, rust.env);
      env.PATH = [...rust.path, ...(env.PATH ? [env.PATH] : [])].join(path.delimiter);
    }
    let result: RunResult;
    if (isolated) {
      const profile = path.join(root, 'sandbox.sb');
      await writeFile(profile, await buildProfile(root, [request.allowedRoot], rust?.readOnly ?? []), 'utf8');
      result = await runBounded(SANDBOX_EXEC, ['-f', profile, '/bin/sh', '-c', command], work, env, timeoutMs, maxOutputBytes);
    } else {
      result = await runBounded('/bin/sh', ['-c', command], work, env, timeoutMs, maxOutputBytes);
    }
    const payload: TestPayload & { isolation: 'sandbox-exec' | 'none' } = {
      status: runStatus(result),
      command,
      output: result.output,
      signal: 'rerun',
      rerun_of: request.rerunOf,
      isolation: isolated ? 'sandbox-exec' : 'none',
    };
    const outPath = request.outPath ?? path.join(process.cwd(), '.devlens', 'rerun.jsonl');
    const event: Event = {
      id: `sandbox:${request.rerunOf}:${randomUUID()}`,
      session_id: request.sessionId,
      project_id: request.projectId,
      ts: new Date().toISOString(),
      seq: await nextSeq(outPath),
      actor: 'ci',
      type: 'test',
      source: 'sandbox',
      provenance: 'observed',
      recording_ref: null,
      media_offset_ms: null,
      payload,
    };
    await mkdir(path.dirname(outPath), { recursive: true });
    await appendFile(outPath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
