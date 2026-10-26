import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rerunTest } from '../../link/src/rerun';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Thin command for the bounded sandbox re-run. Output stays in the JSONL file.

function usage(): never {
  throw new Error('Usage: devlens rerun --dir <path> --command <command> --rerun-of <event-id> --session <id> --project <id> [--allowed-root <path>] [--unsafe-no-isolation] [--out <file>] [--timeout-ms <n>] [--max-output-bytes <n>]');
}

function parseArgs(argv: readonly string[]) {
  const args = argv[0] === 'rerun' ? argv.slice(1) : [...argv];
  let dir = '';
  let command = '';
  let rerunOf = '';
  let sessionId = '';
  let projectId = '';
  let allowedRoot = path.join(repoRoot, 'examples');
  let allowUnisolated = false;
  let outPath: string | undefined;
  let timeoutMs: number | undefined;
  let maxOutputBytes: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) usage();
      return value;
    };
    if (arg === '--dir') dir = next();
    else if (arg === '--command') command = next();
    else if (arg === '--rerun-of') rerunOf = next();
    else if (arg === '--session') sessionId = next();
    else if (arg === '--project') projectId = next();
    else if (arg === '--allowed-root') allowedRoot = path.resolve(next());
    else if (arg === '--unsafe-no-isolation') allowUnisolated = true;
    else if (arg === '--out') outPath = next();
    else if (arg === '--timeout-ms') timeoutMs = Number(next());
    else if (arg === '--max-output-bytes') maxOutputBytes = Number(next());
    else usage();
  }
  if (!dir || !command || !rerunOf || !sessionId || !projectId) usage();
  if ((timeoutMs != null && !Number.isFinite(timeoutMs)) || (maxOutputBytes != null && !Number.isFinite(maxOutputBytes))) usage();
  return { dir, allowedRoot, allowUnisolated, command, rerunOf, sessionId, projectId, outPath, timeoutMs, maxOutputBytes };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const event = await rerunTest({
    command: options.command,
    cwd: options.dir,
    allowedRoot: options.allowedRoot,
    allowUnisolated: options.allowUnisolated,
    rerunOf: options.rerunOf,
    sessionId: options.sessionId,
    projectId: options.projectId,
    outPath: options.outPath ? path.resolve(options.outPath) : undefined,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  });
  const status = typeof event.payload.status === 'string' ? event.payload.status : 'unknown';
  console.log(`status: ${status}`);
  console.log(`source: ${event.source}`);
}

const calledDirectly = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (calledDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'rerun failed';
    console.error(message.includes('eyJ') || message.includes('sb_secret') ? 'rerun failed' : message);
    process.exitCode = 1;
  });
}
