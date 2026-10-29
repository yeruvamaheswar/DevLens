// T3 → DevLens question agent. Claude Code starts the agent from its Stop hook; T3 has no hooks, so live
// capture plays that part. When a T3 run completes, the bridge copies the thread's events into the app
// folder's `.devlens/events.jsonl` (the file the agent and the /agent page read) and starts the same agent,
// detached, once per run. Opt-in is the same as for Claude Code: `<app>/.devlens/agent.json` with enabled true.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Event } from '../../core/event';
import { agentOptedIn } from '../../capture/hook';
import type { CaptureRun } from './map';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX_CLI = path.join(HERE, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const AGENT_CLI = path.join(HERE, '..', '..', 'agent', 'src', 'cli.ts');

export type AgentStarter = (projectDir: string, sessionId: string, stopId: string) => void;

const defaultStarter: AgentStarter = (projectDir, sessionId, stopId) => {
  const child = spawn(process.execPath, [TSX_CLI, AGENT_CLI, projectDir, sessionId, stopId], { detached: true, stdio: 'ignore' });
  child.on('error', (error) => process.stderr.write(`devlens t3 bridge: agent not started: ${error.message}\n`));
  child.unref();
};

// The stop id the agent keys its question on: one per completed T3 run.
export const stopIdFor = (sessionId: string, run: Pick<CaptureRun, 'run_ordinal'>) => `${sessionId}:run:${run.run_ordinal}`;

export type BridgeResult = { appended: number; started: string[]; skipped: 'opt_in_off' | null };

export function bridgeQuestions(options: {
  root: string;
  events: Event[];
  runs: CaptureRun[];
  started: Set<string>;
  startAgent?: AgentStarter;
}): BridgeResult {
  if (!agentOptedIn(options.root)) return { appended: 0, started: [], skipped: 'opt_in_off' };
  const eventsPath = path.join(options.root, '.devlens', 'events.jsonl');
  mkdirSync(path.dirname(eventsPath), { recursive: true });
  const known = new Set<string>();
  if (existsSync(eventsPath)) {
    for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { known.add((JSON.parse(line) as Event).id); } catch { /* skip a torn line */ }
    }
  }
  // Session events only (prompts, actions, edits, tests, checkpoints). They were redacted at import.
  const fresh = options.events.filter((event) => event.source === 't3_code' && !known.has(event.id));
  if (fresh.length > 0) appendFileSync(eventsPath, fresh.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

  const sessionId = options.events.find((event) => event.source === 't3_code')?.session_id ?? null;
  const started: string[] = [];
  if (sessionId) {
    for (const run of options.runs) {
      if (run.run_status !== 'completed' || !run.completed_at) continue;
      const stopId = stopIdFor(sessionId, run);
      if (options.started.has(stopId)) continue;
      options.started.add(stopId);
      // The agent itself skips a stop it already asked at, so a restarted watcher cannot ask twice.
      (options.startAgent ?? defaultStarter)(options.root, sessionId, stopId);
      started.push(stopId);
    }
  }
  return { appended: fresh.length, started, skipped: null };
}
