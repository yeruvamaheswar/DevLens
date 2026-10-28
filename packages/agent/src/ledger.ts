import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { EngineResult } from './types';

export const MAX_CALLS_PER_SESSION = 30;
const STALE_LOCK_MS = 120_000;

export function ledgerPathFor(projectDir: string): string {
  return path.join(projectDir, '.devlens', 'agent-ledger.jsonl');
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquire(lockPath: string): (() => void) | null {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      closeSync(openSync(lockPath, 'wx'));
      return () => { try { unlinkSync(lockPath); } catch { /* already cleared */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try { if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) unlinkSync(lockPath); } catch { /* gone */ }
      sleepMs(25);
    }
  }
  return null;
}

function lines(ledgerPath: string): Record<string, unknown>[] {
  if (!existsSync(ledgerPath)) return [];
  const out: Record<string, unknown>[] = [];
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip damaged line */ }
  }
  return out;
}

// Reserve one call slot before the engine runs. Returns why not when the budget is spent or the lock is stuck.
export function reserveSlot(ledgerPath: string, session_id: string, stop_event_id: string, now: Date, max = MAX_CALLS_PER_SESSION): { ok: true } | { ok: false; reason: 'budget_exhausted' | 'ledger_locked' | 'already_run_at_this_stop' } {
  const release = acquire(`${ledgerPath}.lock`);
  if (!release) return { ok: false, reason: 'ledger_locked' };
  try {
    const reserved = lines(ledgerPath).filter((line) => line.kind === 'reserved' && line.session_id === session_id);
    if (reserved.some((line) => line.stop_event_id === stop_event_id)) return { ok: false, reason: 'already_run_at_this_stop' }; // zero retries (NOT-7)
    const used = reserved.length;
    if (used >= max) return { ok: false, reason: 'budget_exhausted' };
    appendFileSync(ledgerPath, `${JSON.stringify({ ts: now.toISOString(), kind: 'reserved', session_id, stop_event_id })}\n`, 'utf8');
    return { ok: true };
  } finally { release(); }
}

// No prompt text goes in the ledger. The error is cut short and carries no reply text.
export function recordResult(ledgerPath: string, session_id: string, result: EngineResult, now: Date): void {
  const line: Record<string, unknown> = { ts: now.toISOString(), kind: 'result', session_id, route: result.route, model: result.model, duration_ms: result.duration_ms, ok: result.ok };
  if (!result.ok) line.error = result.error.slice(0, 200);
  const release = acquire(`${ledgerPath}.lock`);
  if (!release) return; // no lock, no write: never append beside another writer
  try { appendFileSync(ledgerPath, `${JSON.stringify(line)}\n`, 'utf8'); } finally { release(); }
}
