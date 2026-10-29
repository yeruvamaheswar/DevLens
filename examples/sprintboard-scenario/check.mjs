// Verifies the three SprintBoard scenario states against a throwaway copy of
// the `starter` tag. The real sprintboard-demo checkout is never modified.
// Usage: node check.mjs [path-to-sprintboard-demo]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const repo = resolve(process.argv[2] ?? join(here, '..', '..', '..', 'sprintboard-demo'));

const STATES = [
  {
    name: 'starter',
    patch: null,
    expectPass: false,
    reason: /expected status 200 for status=in-progress, got 400/,
    reasonText: '400 invalid_status',
  },
  {
    name: 'starter + incorrect-fix',
    patch: 'incorrect-fix.patch',
    expectPass: false,
    reason: /expected 3 in-progress issues, got 0/,
    reasonText: 'expected 3 issues, got 0',
  },
  {
    name: 'starter + final-fix',
    patch: 'final-fix.patch',
    expectPass: true,
    reason: null,
    reasonText: 'all tests pass',
  },
];

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function runState(state) {
  const dir = mkdtempSync(join(tmpdir(), 'sprintboard-check-'));
  try {
    const archive = execFileSync('git', ['-C', repo, 'archive', 'starter'], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: archive });
    if (state.patch) {
      execFileSync('git', ['apply', join(here, state.patch)], { cwd: dir });
    }
    const result = spawnSync('npm', ['test', '--silent', '--', '--test-reporter=spec'], {
      cwd: dir,
      encoding: 'utf8',
    });
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
    const failed = [...new Set([...output.matchAll(/^\s*✖ (.+?) \([\d.]+ms\)$/gm)].map((m) => m[1]))]
      .filter((name) => !name.startsWith('failing tests'));
    return { passed: result.status === 0, output, failed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rows = [];
let mismatches = 0;
for (const state of STATES) {
  const { passed, output, failed } = runState(state);
  const problems = [];
  if (passed !== state.expectPass) problems.push(`expected ${state.expectPass ? 'pass' : 'fail'}`);
  if (state.reason && !state.reason.test(output)) problems.push(`reason not found: ${state.reasonText}`);
  if (!state.expectPass && failed.some((name) => !/in-progress/.test(name))) {
    problems.push(`unrelated failures: ${failed.join('; ')}`);
  }
  if (problems.length) mismatches += 1;
  rows.push({
    State: state.name,
    Result: passed ? 'pass' : `fail (${failed.length})`,
    Expected: state.expectPass ? 'pass' : `fail: ${state.reasonText}`,
    Match: problems.length ? `NO: ${problems.join(', ')}` : 'yes',
  });
}

console.table(rows);
if (mismatches > 0) {
  console.error(`${mismatches} state(s) did not match.`);
  process.exit(1);
}
console.log('All 3 states match.');
