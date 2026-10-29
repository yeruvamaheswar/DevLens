import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Event } from '../core/event';

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireLock(lockPath: string): () => void {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return () => {
        try { unlinkSync(lockPath); } catch { /* another writer already cleared it */ }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 10_000) unlinkSync(lockPath);
      } catch { /* lock disappeared */ }
      sleepMs(25);
    }
  }
  throw new Error(`devlens: could not lock ${lockPath}`);
}

export function appendEvent(eventsPath: string, event: Event): Event {
  mkdirSync(path.dirname(eventsPath), { recursive: true });
  const release = acquireLock(`${eventsPath}.lock`);
  try {
    let seq = 1;
    if (existsSync(eventsPath)) {
      const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
      seq = lines.length + 1;
    }
    const written: Event = { ...event, seq };
    appendFileSync(eventsPath, `${JSON.stringify(written)}\n`, 'utf8');
    return written;
  } finally {
    release();
  }
}
