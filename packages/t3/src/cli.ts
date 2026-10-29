// DevLens T3 Code adapter (experimental). Reads one T3 thread read-only and writes DevLens events.
//   npx tsx packages/t3/src/cli.ts list [--workspace <dir>] [--db <statev2.sqlite>]
//   npx tsx packages/t3/src/cli.ts import --thread <id> [--out <dir>] [--recording <meta.json>] [--rerun <rerun.jsonl>] [--no-git] [--db <path>]
//   npx tsx packages/t3/src/cli.ts verify --thread <id>   (sandbox re-run of the last passing test, then re-import)
//   --root <dir>: paths relative to <dir> instead of the thread's checkout. --no-checkpoints: leave T3 git checkpoints out.
// Output (default .devlens/t3/<thread>/, git-ignored): events.jsonl, edges.jsonl, capture.json.
// A recording-meta.json or rerun.jsonl already in that folder is used again on re-import.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Event, RecordingMeta } from '../../core/event';
import { attachMedia } from '../../core/src/sync';
import { planSession } from '../../cli/src/link';
import { redactValue, secretValuesFromEnv, shortSecretValuesFromEnv } from '../../capture/redact';
import { DEFAULT_T3_DB, listThreads, openT3, readThread } from './store';
import { mapThread } from './map';
import { rerunTest } from '../../link/src/rerun';

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
  importThread(args);
}

function importThread(args: Args): void {
  const threadId = flag(args, 'thread');
  if (!threadId) throw new Error('import needs --thread <id>. Run `list` to find one.');
  const out = outDir(args, threadId);
  const db = openT3(flag(args, 'db') ?? DEFAULT_T3_DB);
  let snapshot;
  try {
    snapshot = readThread(db, threadId);
  } finally {
    db.close();
  }
  const rootFlag = flag(args, 'root');
  const { events, capture } = mapThread(snapshot, { root: rootFlag ? path.resolve(rootFlag) : undefined, checkpoints: !args.flags.has('no-checkpoints') });
  const root = (rootFlag ? path.resolve(rootFlag) : null) ?? (typeof snapshot.thread.payload.worktreePath === 'string' ? snapshot.thread.payload.worktreePath : null) ?? snapshot.project?.workspace_root ?? null;
  if (root && existsSync(root) && !args.flags.has('no-git')) {
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
  const recordingFile = flag(args, 'recording') ?? (existsSync(savedMeta) ? savedMeta : null);
  if (recordingFile) {
    const meta = JSON.parse(readFileSync(recordingFile, 'utf8')) as RecordingMeta;
    if (meta.consent !== true || meta.audio_tracks !== 0) throw new Error('The recording meta lacks consent or has audio. Not attached.');
    mapped = attachMedia(mapped, meta);
    capture.recording = { recording_ref: meta.recording_ref, mode: meta.mode };
    const outside = mapped.filter((event) => event.media_offset_ms == null && event.type !== 'checkpoint').length;
    if (outside > 0) capture.unknowns.push(`${outside} events fall outside the recording window or inside a pause. They have no footage.`);
  }

  const savedRerun = path.join(out, 'rerun.jsonl');
  const rerunFile = flag(args, 'rerun') ?? (existsSync(savedRerun) ? savedRerun : null);
  const rerun = rerunFile ? readJsonl(rerunFile) : [];
  capture.rerun = rerun.length > 0;
  const plan = planSession([...mapped.map((event, order) => ({ event, order })), ...rerun.map((event, index) => ({ event, order: mapped.length + index }))]);

  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'events.jsonl'), plan.events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(path.join(out, 'edges.jsonl'), plan.edges.map((edge) => JSON.stringify(edge)).join('\n') + (plan.edges.length ? '\n' : ''));
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');

  const count = (type: string) => plan.events.filter((event) => event.type === type).length;
  const tests = plan.events.filter((event) => event.type === 'test' && event.source === 't3_code');
  console.log(`Imported T3 thread ${threadId} "${capture.t3.title}" into ${out}`);
  console.log(`runs=${capture.runs.length} prompts=${count('prompt')} tool_calls=${count('tool_call')} edits=${count('file_edit')} tests=${tests.length} (failed ${tests.filter((t) => t.payload.status === 'failed').length}, passed ${tests.filter((t) => t.payload.status === 'passed').length}) checkpoints=${count('checkpoint')} rerun=${rerun.length} edges=${plan.edges.length}`);
  console.log(`models: ${[...new Set(capture.runs.map((run) => `${run.provider}/${run.model}`))].join(', ')}${capture.model_switches.length ? `; switches=${capture.model_switches.length}` : ''}`);
  for (const line of capture.unknowns) console.log(`unknown: ${line}`);
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === 'list') list(args);
  else if (args.command === 'import') importThread(args);
  else if (args.command === 'verify') await verify(args);
  else {
    console.log('Usage: tsx packages/t3/src/cli.ts list [--workspace <dir>] | import --thread <id> [--out <dir>] [--recording <meta.json>] [--rerun <rerun.jsonl>] [--no-git] | verify --thread <id> [--dir <checkout>]');
    process.exitCode = args.command === 'help' ? 0 : 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
