// Patch files under states/ are verifier inputs. They are not a recorded take.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, cp, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const repoRoot = path.resolve(exampleRoot, '../..');
const starterFiles = ['package.json', 'README.md', 'src/client.js', 'tests/client.test.js'];
const baseUrlFailure = 'wrong base URL: expected /api, received /v0';
const headerFailure = 'expected Authorization header';

const allStarterScenarios = [
  'broken-api',
  'swapped-field',
  'missing-auth',
  'stale-cache',
  'wrong-page',
  'bad-date',
  'empty-list',
];

function fail(state, detail) {
  console.log(`${state}: FAIL`);
  if (detail) console.log(detail.trimEnd());
  return false;
}

function assertOutsideRepo(dir) {
  const repo = realpathSync(repoRoot);
  const target = realpathSync(dir);
  if (target === repo || target.startsWith(repo + path.sep)) {
    throw new Error(`refusing to run inside the repo: ${target}`);
  }
}

async function copyStarter(dir) {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'tests'), { recursive: true });
  for (const rel of starterFiles) {
    await cp(path.join(exampleRoot, rel), path.join(dir, rel));
  }
}

function runNpmTest(cwd) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['test'], {
      cwd,
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: '1',
        npm_config_fund: 'false',
        npm_config_audit: 'false',
        npm_config_update_notifier: 'false',
        npm_config_offline: 'true',
      },
    });
    const chunks = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

function applyPatch(dir, patchPath) {
  return new Promise((resolve) => {
    const child = spawn('git', ['apply', patchPath], { cwd: dir });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, err }));
  });
}

async function verifyAllStarters() {
  let ok = true;
  for (const name of allStarterScenarios) {
    const root = await mkdtemp(path.join(tmpdir(), `devlens-${name}-`));
    try {
      assertOutsideRepo(root);
      const scenarioSrc = path.join(repoRoot, 'examples', name);
      await cp(scenarioSrc, root, { recursive: true });

      let expectedSubstring;
      if (name === 'broken-api') {
        expectedSubstring = baseUrlFailure;
      } else {
        const scenarioJsonPath = path.join(root, 'scenario.json');
        if (!existsSync(scenarioJsonPath)) {
          console.log(`${name}: FAIL: missing scenario.json`);
          ok = false;
          continue;
        }
        const scenarioConfig = JSON.parse(await readFile(scenarioJsonPath, 'utf8'));
        expectedSubstring = scenarioConfig.failure;
      }

      const run = await runNpmTest(root);
      if (run.code === 0) {
        console.log(`${name}: FAIL: test unexpectedly passed`);
        ok = false;
      } else if (run.out.includes('SyntaxError') || !run.out.includes(`AssertionError [ERR_ASSERTION]: ${expectedSubstring}`)) {
        console.log(`${name}: FAIL: expected failure "${expectedSubstring}" not found in output`);
        ok = false;
      } else {
        console.log(`${name}: PASS`);
      }
    } catch (err) {
      console.log(`${name}: FAIL: ${err instanceof Error ? err.message : String(err)}`);
      ok = false;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  if (!ok) process.exit(1);
}

async function main() {
  const scenario = process.argv[2];
  if (scenario === '--all-starters') {
    await verifyAllStarters();
    return;
  }

  if (scenario !== 'broken-api') {
    console.log('usage: FAIL');
    console.log('usage: npm run scenario:verify -- broken-api');
    process.exit(1);
  }

  console.log('verifier inputs, not a recorded take');
  let ok = true;
  const root = await mkdtemp(path.join(tmpdir(), 'devlens-scenario-'));
  try {
    assertOutsideRepo(root);

    const starterDir = path.join(root, 'starter');
    await mkdir(starterDir);
    await copyStarter(starterDir);
    const starterSource = await readFile(path.join(starterDir, 'src/client.js'), 'utf8');
    if (!starterSource.includes('/v0') || starterSource.includes('Authorization')) {
      ok = fail('starter', 'starter client is not the base-URL state') && ok;
    } else {
      const starter = await runNpmTest(starterDir);
      const starterHit = starter.out.includes(baseUrlFailure);
      const starterLeaked = starter.out.includes(headerFailure);
      if (starter.code !== 0 && starterHit && !starterLeaked) console.log('starter: PASS');
      else ok = fail('starter', starter.out) && ok;
    }

    const firstPatch = path.join(here, 'states', 'first-fix.patch');
    const firstText = existsSync(firstPatch) ? await readFile(firstPatch, 'utf8') : '';
    const firstDir = path.join(root, 'first-fix');
    await mkdir(firstDir);
    await copyStarter(firstDir);
    if (!firstText || firstText.includes('Authorization') || firstText.includes('Bearer') || !firstText.includes('/api')) {
      ok = fail('first-fix', 'first-fix patch must change only the base URL') && ok;
    } else {
      const applied = await applyPatch(firstDir, firstPatch);
      if (applied.code !== 0) ok = fail('first-fix', applied.err || 'git apply failed') && ok;
      else {
        const first = await runNpmTest(firstDir);
        const hit = first.out.includes(headerFailure);
        const stillBase = first.out.includes(baseUrlFailure);
        if (first.code !== 0 && hit && !stillBase) console.log('first-fix: PASS');
        else ok = fail('first-fix', first.out) && ok;
      }
    }

    const finalPatch = path.join(here, 'states', 'final-fix.patch');
    const finalText = existsSync(finalPatch) ? await readFile(finalPatch, 'utf8') : '';
    const finalDir = path.join(root, 'final-fix');
    await mkdir(finalDir);
    await copyStarter(finalDir);
    if (!finalText.includes('/api') || !finalText.includes('Authorization')) {
      ok = fail('final-fix', 'final-fix patch must include both fixes') && ok;
    } else {
      const applied = await applyPatch(finalDir, finalPatch);
      if (applied.code !== 0) ok = fail('final-fix', applied.err || 'git apply failed') && ok;
      else {
        const finalRun = await runNpmTest(finalDir);
        const passed = finalRun.code === 0 && /ℹ pass [1-9]/.test(finalRun.out) && /ℹ fail 0/.test(finalRun.out);
        if (passed) console.log('final-fix: PASS');
        else ok = fail('final-fix', finalRun.out) && ok;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.log(`starter: FAIL`);
  console.log(error instanceof Error ? error.message : 'scenario verify failed');
  process.exit(1);
});
