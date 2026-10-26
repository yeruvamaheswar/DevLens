import { readFileSync } from 'node:fs';
import { handleHook } from './handle';

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && entry.replaceAll('\\', '/').endsWith('/packages/capture/hook.ts');
}

if (isDirectRun()) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('devlens hook: stdin was not JSON\n');
    process.exit(0);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stderr.write('devlens hook: payload was not an object\n');
    process.exit(0);
  }
  try {
    handleHook(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'write failed';
    process.stderr.write(`devlens hook: ${message}\n`);
    process.exit(0);
  }
}
