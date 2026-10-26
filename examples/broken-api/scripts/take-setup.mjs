import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const repoRoot = path.resolve(exampleRoot, '../..');
const starterFiles = ['package.json', 'README.md', 'src/client.js', 'tests/client.test.js'];
const prompt = 'Run `npm test`. Fix only the failure it prints, then stop and leave the test result visible. Do not guess at further changes.';

function gitValue(key) {
  return execFileSync('git', ['config', '--get', key], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function shellSingle(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const name = gitValue('user.name');
const email = gitValue('user.email');
if (!name || !email) {
  process.stderr.write('git user.name and user.email are required\n');
  process.exit(1);
}

const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'devlens-broken-api-')));
const repoReal = realpathSync(repoRoot);
if (dir === repoReal || dir.startsWith(repoReal + path.sep)) {
  process.stderr.write('temp directory is inside the repo\n');
  process.exit(1);
}

mkdirSync(path.join(dir, 'src'), { recursive: true });
mkdirSync(path.join(dir, 'tests'), { recursive: true });
for (const rel of starterFiles) cpSync(path.join(exampleRoot, rel), path.join(dir, rel));

const gitEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'user.name',
  GIT_CONFIG_VALUE_0: name,
  GIT_CONFIG_KEY_1: 'user.email',
  GIT_CONFIG_VALUE_1: email,
  GIT_CONFIG_KEY_2: 'commit.gpgsign',
  GIT_CONFIG_VALUE_2: 'false',
  GIT_AUTHOR_NAME: name,
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: name,
  GIT_COMMITTER_EMAIL: email,
  GIT_TERMINAL_PROMPT: '0',
};

execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'inherit' });
execFileSync('git', ['add', '--', ...starterFiles], { cwd: dir, stdio: 'inherit' });
execFileSync('git', ['commit', '-m', 'starter'], { cwd: dir, env: gitEnv, stdio: 'inherit' });
execFileSync('npx', ['--no-install', 'tsx', 'packages/cli/src/init.ts', dir], { cwd: repoRoot, stdio: 'inherit' });

const settingsPath = path.join(dir, '.claude', 'settings.local.json');
if (!existsSync(settingsPath)) {
  process.stderr.write('project-local hooks were not written\n');
  process.exit(1);
}
const settings = readFileSync(settingsPath, 'utf8');
if (!settings.includes('packages/capture/hook.ts') || !settingsPath.startsWith(dir + path.sep)) {
  process.stderr.write('project-local hooks do not point at the DevLens hook\n');
  process.exit(1);
}

const quoted = shellSingle(dir);
process.stdout.write(`\nWorking copy: ${dir}\n`);
process.stdout.write('Next commands:\n');
process.stdout.write(`  cd ${quoted}\n`);
process.stdout.write('  npm test\n');
process.stdout.write('  claude\n');
process.stdout.write('Prompt:\n');
process.stdout.write(`${prompt}\n`);
process.stdout.write('After that edit stops, restore anything other than the client, then commit:\n');
process.stdout.write('  git checkout HEAD -- tests README.md package.json\n');
process.stdout.write('  git add src/client.js\n');
process.stdout.write('  git commit -m first-fix\n');
process.stdout.write('  claude\n');
process.stdout.write('Use the same prompt. After npm test passes:\n');
process.stdout.write('  git checkout HEAD -- tests README.md package.json\n');
process.stdout.write('  git add src/client.js\n');
process.stdout.write('  git commit -m final-fix\n');
process.stdout.write('Record, review, and export with examples/broken-api/RECORDING.md.\n');
