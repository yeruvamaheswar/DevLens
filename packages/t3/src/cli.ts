// DevLens T3 Code adapter (experimental). Reads one T3 thread read-only and writes DevLens events.
//   npx tsx packages/t3/src/cli.ts list [--workspace <dir>] [--db <statev2.sqlite>]
//   npx tsx packages/t3/src/cli.ts import --thread <id> [--out <dir>] [--recording <meta.json>] [--rerun <rerun.jsonl>] [--no-git] [--db <path>]
//   npx tsx packages/t3/src/cli.ts watch (--thread <id> | --workspace <dir>) [--interval <ms>]   (live capture: re-import when the thread changes)
//   npx tsx packages/t3/src/cli.ts verify --thread <id>   (sandbox re-run of the last passing test, then re-import)
//   --root <dir>: paths relative to <dir> instead of the thread's checkout. --no-checkpoints: leave T3 git checkpoints out.
//   npx tsx packages/t3/src/cli.ts save --thread <id> --as <name> [--with-recording]   (copy into examples/t3-captures/<name>, home paths as ~)
//   npx tsx packages/t3/src/cli.ts publish --thread <id> [--as <name>] [--with-recording]   (upload to the private t3-captures bucket for the hosted journey)
// Output (default .devlens/t3/<thread>/, git-ignored): events.jsonl, edges.jsonl, capture.json.
// A recording-meta.json or rerun.jsonl already in that folder is used again on re-import.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Event, RecordingMeta } from '../../core/event';
import { attachMedia } from '../../core/src/sync';
import { planSession } from '../../cli/src/link';
import { redactValue, secretValuesFromEnv, shortSecretValuesFromEnv } from '../../capture/redact';
import { DEFAULT_T3_DB, listThreads, openT3, readThread } from './store';
import { mapThread } from './map';
import { rerunTest } from '../../link/src/rerun';
import { startWatch } from './watch';
import { captureBucketFromEnv, defaultPublishName, publishCapture } from './publish';
import { readThreadViaRpc } from './rpc';
import { bridgeQuestions } from './bridge';
import type { T3ThreadSnapshot } from './store';

type Args = { command: string; flags: Map<string, string | true> };

function parseArgs(argv: readonly string[]): Args {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags.set(key.slice(2), true);
    else {
      flags.set(key.slice(2), next);
      i++;
    }
  }
  return { command, flags };
}

function flag(args: Args, name: string): string | null {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : null;
}

function readJsonl(file: string): Event[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as Event;
      } catch {
        throw new Error(`${file} line ${index + 1} is not JSON`);
      }
    });
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Diff between the previous checkpoint ref and this one: what git saw change during the run.
function attachGitDiffs(events: Event[], root: string): number {
  let attached = 0;
  for (const event of events) {
    if (event.type !== 'checkpoint') continue;
    const ref = typeof event.payload.ref === 'string' ? event.payload.ref : null;
    const match = ref?.match(/^(.*\/ordinal\/)(\d+)$/);
    if (!ref || !match || Number(match[2]) === 0) continue;
    const parent = `${match[1]}${Number(match[2]) - 1}`;
    if (git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) == null || git(root, ['rev-parse', '--verify', '--quiet', `${parent}^{commit}`]) == null) continue;
    const diff = git(root, ['diff', '--no-color', '--no-ext-diff', parent, ref]);
    if (diff == null) continue;
    event.payload.git_diff = diff.length > 6000 ? `${diff.slice(0, 6000)}\n…[truncated by DevLens]` : diff;
    event.payload.git_diff_basis = `git diff ${parent.split('/').slice(-2).join('/')} → ${ref.split('/').slice(-2).join('/')} (T3 checkpoint refs)`;
    attached++;
  }
  return attached;
}

function list(args: Args): void {
  const db = openT3(flag(args, 'db') ?? DEFAULT_T3_DB);
  try {
    const rows = listThreads(db, flag(args, 'workspace') ?? undefined);
    for (const row of rows.slice(0, Number(flag(args, 'limit') ?? 20))) {
      console.log(`${row.thread_id}  runs=${row.runs}  ${row.updated_at}  [${row.project_title ?? '?'}] ${row.title}`);
    }
    if (rows.length === 0) console.log('No T3 threads found for that workspace.');
  } finally {
    db.close();
  }
}

function outDir(args: Args, threadId: string): string {
  return flag(args, 'out') ?? path.join(process.cwd(), '.devlens', 't3', threadId);
}

function threadRoot(args: Args, threadId: string): string | null {
  const db = openT3(flag(args, 'db') ?? DEFAULT_T3_DB);
  try {
    const snapshot = readThread(db, threadId);
    return (typeof snapshot.thread.payload.worktreePath === 'string' ? snapshot.thread.payload.worktreePath : null) ?? snapshot.project?.workspace_root ?? null;
  } finally {
    db.close();
  }
}

// `cd <checkout> && npm test` becomes `npm test`, run inside the sandbox copy. Any other command is kept as it is.
export function inCopy(command: string, root: string): string {
  const match = command.match(/^\s*cd\s+(["']?)([^"'&;|]+)\1\s*&&\s*(.+)$/s);
  if (!match) return command;
  const target = match[2].trim().replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
  return path.resolve(target) === path.resolve(root) ? match[3].trim() : command;
}

// Independent verification: a separate sandbox worker re-runs the last passing test command on a copy of the checkout.
async function verify(args: Args): Promise<void> {
  const threadId = flag(args, 'thread');
  if (!threadId) throw new Error('verify needs --thread <id>.');
  const out = outDir(args, threadId);
  const file = path.join(out, 'events.jsonl');
  if (!existsSync(file)) throw new Error(`Import the thread first: no ${file}.`);
  const pass = [...readJsonl(file)].reverse().find((event) => event.type === 'test' && event.source === 't3_code' && event.payload.status === 'passed');
  if (!pass) throw new Error('No passing test in this thread. Nothing to verify.');
  const root = flag(args, 'dir') ?? flag(args, 'root') ?? threadRoot(args, threadId);
  if (!root || !existsSync(root)) throw new Error('The thread checkout is not available.');
  const rerunFile = path.join(out, 'rerun.jsonl');
  rmSync(rerunFile, { force: true });
  const command = String(pass.payload.command);
  const run = inCopy(command, root);
  const event = await rerunTest({ command: run, cwd: root, allowedRoot: path.dirname(root), rerunOf: pass.id, sessionId: pass.session_id, projectId: pass.project_id, outPath: rerunFile });
  if (run !== command) {
    // The sandbox cannot enter the real checkout, by design. Say what ran instead of the session's command.
    const lines = readJsonl(rerunFile).map((item) => (item.id === event.id ? { ...item, payload: { ...item.payload, command, ran_as: run, ran_as_note: `The session command starts with cd into ${path.basename(root)}. The worker ran the rest in its copy of that folder.` } } : item));
    writeFileSync(rerunFile, lines.map((item) => JSON.stringify(item)).join('\n') + '\n');
  }
  console.log(`Sandbox re-run of "${run}" on a copy of ${path.basename(root)}: ${String(event.payload.status)}`);
  await importThread(args);
}

export type ImportOptions = {
  threadId: string;
  out: string;
  db: string;
  root: string | null;
  recording: string | null;
  rerun: string | null;
  noGit: boolean;
  noCheckpoints: boolean;
  // Set when the thread was read through T3's RPC (`--via rpc`) instead of the database.
  snapshot?: T3ThreadSnapshot;
};

export type ImportResult = { events: Event[]; edgeCount: number; rerunCount: number; capture: ReturnType<typeof mapThread>['capture'] };

// The one import path. `import` and `watch` both call it, so a watched capture equals a one-shot import.
export function runImport(options: ImportOptions): ImportResult {
  const { threadId, out } = options;
  let snapshot = options.snapshot;
  if (!snapshot) {
    const db = openT3(options.db);
    try {
      snapshot = readThread(db, threadId);
    } finally {
      db.close();
    }
  }
  const rootFlag = options.root;
  const { events, capture } = mapThread(snapshot, { root: rootFlag ? path.resolve(rootFlag) : undefined, checkpoints: !options.noCheckpoints });
  const root = (rootFlag ? path.resolve(rootFlag) : null) ?? (typeof snapshot.thread.payload.worktreePath === 'string' ? snapshot.thread.payload.worktreePath : null) ?? snapshot.project?.workspace_root ?? null;
  if (root && existsSync(root) && !options.noGit) {
    const count = attachGitDiffs(events, root);
    if (count === 0 && events.some((event) => event.type === 'checkpoint')) capture.unknowns.push('No git diff could be read for the T3 checkpoints in this checkout.');
  } else if (events.some((event) => event.type === 'checkpoint')) {
    capture.unknowns.push('The checkout was not available, so checkpoint diffs were not read from git.');
  }

  // Redact before anything is written, with the same rules as the Claude Code hook.
  const secrets = secretValuesFromEnv(process.env);
  const shorts = shortSecretValuesFromEnv(process.env);
  let mapped = events.map((event) => redactValue(event, secrets, shorts));

  const savedMeta = path.join(out, 'recording-meta.json');
  const recordingFile = options.recording ?? (existsSync(savedMeta) ? savedMeta : null);
  if (recordingFile) {
    const meta = JSON.parse(readFileSync(recordingFile, 'utf8')) as RecordingMeta;
    if (meta.consent !== true || meta.audio_tracks !== 0) throw new Error('The recording meta lacks consent or has audio. Not attached.');
    mapped = attachMedia(mapped, meta);
    capture.recording = { recording_ref: meta.recording_ref, mode: meta.mode };
    const outside = mapped.filter((event) => event.media_offset_ms == null && event.type !== 'checkpoint').length;
    if (outside > 0) capture.unknowns.push(`${outside} events fall outside the recording window or inside a pause. They have no footage.`);
  }

  const savedRerun = path.join(out, 'rerun.jsonl');
  const rerunFile = options.rerun ?? (existsSync(savedRerun) ? savedRerun : null);
  const rerun = rerunFile ? readJsonl(rerunFile) : [];
  capture.rerun = rerun.length > 0;
  const plan = planSession([...mapped.map((event, order) => ({ event, order })), ...rerun.map((event, index) => ({ event, order: mapped.length + index }))]);

  mkdirSync(out, { recursive: true });
  // Keep a live watch stamp across re-imports, so the page never sees the capture as not live mid-import.
  const previous = path.join(out, 'capture.json');
  if (existsSync(previous)) {
    try {
      const stamp = (JSON.parse(readFileSync(previous, 'utf8')) as { watch?: unknown }).watch;
      if (stamp) (capture as Record<string, unknown>).watch = stamp;
    } catch {
      // A broken previous file is replaced below.
    }
  }
  // Each file is written whole, then renamed, so a reader never sees a half-written file (review finding 5).
  writeAtomic(path.join(out, 'events.jsonl'), plan.events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  writeAtomic(path.join(out, 'edges.jsonl'), plan.edges.map((edge) => JSON.stringify(edge)).join('\n') + (plan.edges.length ? '\n' : ''));
  writeAtomic(previous, JSON.stringify(capture, null, 2) + '\n');
  return { events: plan.events, edgeCount: plan.edges.length, rerunCount: rerun.length, capture };
}

function importOptions(args: Args, threadId: string): ImportOptions {
  const rootFlag = flag(args, 'root');
  return {
    threadId,
    out: outDir(args, threadId),
    db: flag(args, 'db') ?? DEFAULT_T3_DB,
    root: rootFlag,
    recording: flag(args, 'recording'),
    rerun: flag(args, 'rerun'),
    noGit: args.flags.has('no-git'),
    noCheckpoints: args.flags.has('no-checkpoints'),
  };
}

async function importThread(args: Args): Promise<void> {
  const threadId = flag(args, 'thread');
  if (!threadId) throw new Error('import needs --thread <id>. Run `list` to find one.');
  const via = flag(args, 'via') ?? 'db';
  if (via !== 'db' && via !== 'rpc') throw new Error('--via must be db or rpc.');
  const out = outDir(args, threadId);
  // `--via rpc` reads through T3's authenticated RPC (read-only methods only; pair once, see packages/t3/README.md).
  const snapshot = via === 'rpc' ? await readThreadViaRpc(threadId) : undefined;
  const { events, edgeCount, rerunCount, capture } = runImport({ ...importOptions(args, threadId), snapshot });
  const count = (type: string) => events.filter((event) => event.type === type).length;
  const tests = events.filter((event) => event.type === 'test' && event.source === 't3_code');
  console.log(`Imported T3 thread ${threadId} "${capture.t3.title}" into ${out}`);
  console.log(`runs=${capture.runs.length} prompts=${count('prompt')} tool_calls=${count('tool_call')} edits=${count('file_edit')} tests=${tests.length} (failed ${tests.filter((t) => t.payload.status === 'failed').length}, passed ${tests.filter((t) => t.payload.status === 'passed').length}) checkpoints=${count('checkpoint')} rerun=${rerunCount} edges=${edgeCount}`);
  console.log(`models: ${[...new Set(capture.runs.map((run) => `${run.provider}/${run.model}`))].join(', ')}${capture.model_switches.length ? `; switches=${capture.model_switches.length}` : ''}`);
  for (const line of capture.unknowns) console.log(`unknown: ${line}`);
}

function writeAtomic(file: string, data: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, file);
}

// --interval in milliseconds: a number, at least 250 (review finding 6).
export function parseInterval(raw: string | true | undefined): number {
  if (raw === undefined) return 2000;
  const value = Number(raw);
  if (raw === true || !Number.isFinite(value) || value < 250) throw new Error('--interval must be a number of milliseconds, at least 250.');
  return value;
}

// Live capture: poll the read-only database and re-import through runImport when the thread changes.
async function watch(args: Args): Promise<void> {
  const thread = flag(args, 'thread');
  const workspace = flag(args, 'workspace');
  if (!thread && !workspace) throw new Error('watch needs --thread <id> or --workspace <dir>.');
  const dbPath = flag(args, 'db') ?? DEFAULT_T3_DB;
  const intervalMs = parseInterval(args.flags.get('interval'));
  const askedAt = new Set<string>();
  const watcher = startWatch({
    db: dbPath,
    thread: thread ?? undefined,
    workspace: workspace ?? undefined,
    outDir: (threadId) => outDir(args, threadId),
    intervalMs,
    importOnce: (threadId) => {
      const result = runImport(importOptions(args, threadId));
      // Questions: when a T3 run completes, start the DevLens question agent, as Claude Code's Stop hook does.
      try {
        // Same root as the import: --root first, then the thread's worktree or project (review findings 3-4).
        const root = flag(args, 'root') ?? threadRoot(args, threadId);
        if (root) {
          const bridged = bridgeQuestions({ root, events: result.events, runs: result.capture.runs, started: askedAt });
          if (bridged.started.length) console.error(`${new Date().toISOString()} question agent started for ${bridged.started.join(', ')}`);
        }
      } catch (error) {
        console.error(`${new Date().toISOString()} question bridge error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { events: result.events.length };
    },
  });
  process.once('SIGINT', () => void watcher.stop());
  process.once('SIGTERM', () => void watcher.stop());
  console.error(`Watching ${thread ? `thread ${thread}` : `the newest thread in ${workspace}`} every ${intervalMs / 1000} s. Ctrl+C stops.`);
  await watcher.done;
}

// A saved capture is committed with the repo, so the hosted journey can show it. Home paths become ~.
function save(args: Args): void {
  const threadId = flag(args, 'thread');
  const name = flag(args, 'as');
  if (!threadId || !name || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(name)) throw new Error('save needs --thread <id> and --as <name> (lowercase letters, digits, dashes).');
  const from = outDir(args, threadId);
  if (!existsSync(path.join(from, 'capture.json'))) throw new Error(`Import the thread first: no ${from}/capture.json.`);
  const to = path.join(process.cwd(), 'examples', 't3-captures', name);
  mkdirSync(to, { recursive: true });
  const home = homedir();
  const scrub = (text: string) => text.split(home).join('~');
  for (const file of ['events.jsonl', 'edges.jsonl', 'capture.json', 'rerun.jsonl', 'recording-meta.json']) {
    const source = path.join(from, file);
    if (existsSync(source)) writeFileSync(path.join(to, file), scrub(readFileSync(source, 'utf8')));
  }
  if (args.flags.has('with-recording') && existsSync(path.join(from, 'recording.webm'))) copyFileSync(path.join(from, 'recording.webm'), path.join(to, 'recording.webm'));
  console.log(`Saved ${threadId} as examples/t3-captures/${name}${args.flags.has('with-recording') ? ' with its recording' : ' without its recording'}. Review it before you commit: it will be public if the repo is.`);
}

// A published capture lives in private storage, so the hosted journey shows it without a Git push. Server key only.
async function publish(args: Args): Promise<void> {
  const threadId = flag(args, 'thread');
  if (!threadId) throw new Error('publish needs --thread <id> [--as <name>] [--with-recording].');
  const name = flag(args, 'as') ?? defaultPublishName(threadId);
  try { process.loadEnvFile?.('.env'); } catch { /* use the process environment */ }
  const bucket = captureBucketFromEnv(process.env, 120_000);
  if (!bucket) throw new Error('NEXT_PUBLIC_SUPABASE_URL (the devlens project) and SUPABASE_SECRET_KEY must be set in .env.');
  const withRecording = args.flags.has('with-recording');
  const uploaded = await publishCapture({ dir: outDir(args, threadId), name, withRecording, bucket });
  for (const item of uploaded) console.log(`${item.object}  ${item.bytes} bytes`);
  console.log(`Published ${threadId} as t3-pub:${name}${withRecording ? ' with its recording' : ' without its recording'}.`);
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === 'list') list(args);
  else if (args.command === 'import') await importThread(args);
  else if (args.command === 'verify') await verify(args);
  else if (args.command === 'watch') await watch(args);
  else if (args.command === 'save') save(args);
  else if (args.command === 'publish') await publish(args);
  else {
    console.log('Usage: tsx packages/t3/src/cli.ts list [--workspace <dir>] | import --thread <id> [--out <dir>] [--recording <meta.json>] [--rerun <rerun.jsonl>] [--no-git] | verify --thread <id> [--dir <checkout>] | watch (--thread <id> | --workspace <dir>) [--interval <ms>]');
    process.exitCode = args.command === 'help' ? 0 : 1;
  }
}

// Run only as the entry point, so tests can import runImport.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
