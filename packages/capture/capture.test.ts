import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleHook } from './handle';
import { mapHook, testStatusFromOutput } from './map-hook';
import { redactString } from './redact';
import { CONSENT_NOTICE, HOOK_EVENTS, init, isDevlensHandler } from '../cli/src/init';

const now = new Date('2026-10-26T20:00:00.123Z');
const fakeSk = 'sk-fakeSecretValue123';
const fakeEnvSecret = 'supabase-fake-value-xyz';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'devlens-capture-'));
}

function homeSettingsSnapshot(): string {
  const dir = path.join(homedir(), '.claude');
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith('settings')).sort();
  } catch {
    return 'missing';
  }
  return names.map((name) => {
    const body = readFileSync(path.join(dir, name));
    return `${name}:${createHash('sha256').update(body).digest('hex')}`;
  }).join('|');
}

describe('redaction before append', () => {
  it('strips a fake sk- string and an env secret from the written file', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const written = handleHook({
      session_id: 'ses_1',
      hook_event_name: 'UserPromptSubmit',
      prompt_id: 'prompt_1',
      prompt: `token ${fakeSk} and secret ${fakeEnvSecret}`,
      cwd: dir,
    }, {
      eventsPath,
      now,
      env: { SUPABASE_SECRET_KEY: fakeEnvSecret, ANTHROPIC_API_KEY: 'anthropic-fake-value-xyz' },
    });
    const text = readFileSync(eventsPath, 'utf8');
    expect(text).not.toContain(fakeSk);
    expect(text).not.toContain(fakeEnvSecret);
    expect(text).not.toContain('anthropic-fake-value-xyz');
    expect(text).toContain('[REDACTED]');
    expect(written?.payload.prompt).toBe('token [REDACTED] and secret [REDACTED]');
    expect(JSON.parse(text).source).toBe('claude_code_hook');
  });

  it('strips bearer and jwt-looking tokens', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const bearer = 'Bearer abcdefghijklmnop';
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0In0.signatureok';
    handleHook({
      session_id: 'ses_1',
      hook_event_name: 'UserPromptSubmit',
      prompt_id: 'prompt_1',
      prompt: `${bearer} ${jwt}`,
      cwd: dir,
    }, { eventsPath, now, env: {} });
    const text = readFileSync(eventsPath, 'utf8');
    expect(text).not.toContain(bearer);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain('abcdefghijklmnop');
  });
});

function promptText(prompt: string, env: Record<string, string | undefined> = {}): string {
  const dir = tempDir();
  const event = handleHook({
    session_id: 'ses_1', hook_event_name: 'UserPromptSubmit', prompt_id: 'p1', prompt, cwd: dir,
  }, { eventsPath: path.join(dir, 'events.jsonl'), now, env });
  return String(event?.payload.prompt);
}

describe('secret assignments and token shapes', () => {
  it('redacts NAME=value, NAME: value and JSON assignments with short unknown values', () => {
    const out = promptText('SUPABASE_SECRET_KEY=hunter2hunter2\nANTHROPIC_API_KEY="shortkey"\nDB_PASSWORD: pw1\n{"MY_TOKEN":"abc"}\nexport GH_TOKEN=x');
    for (const leak of ['hunter2hunter2', 'shortkey', 'pw1', 'abc"', '=x']) expect(out).not.toContain(leak);
    expect(out).toContain('SUPABASE_SECRET_KEY=[REDACTED]');
    expect(out).toContain('"MY_TOKEN":[REDACTED]');
    expect(promptText('NODE_ENV=production LANG: en')).toBe('NODE_ENV=production LANG: en');
  });

  it('redacts github, aws, slack tokens, apikey assignments and Authorization headers', () => {
    const samples = [
      `ghp_${'a1B2c3D4e5'.repeat(3)}`, `gho_${'a1B2c3D4e5'.repeat(3)}`, `github_pat_${'a1B2c3D4e5'.repeat(3)}`,
      'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abcdefghij', 'https://x.io/?apikey=qq77&a=1', 'api_key=zz88', 'access_token=tt99',
      'Authorization: Basic dXNlcjpwYXNz',
    ];
    const out = promptText(samples.join('\n'));
    for (const leak of ['a1B2c3D4e5', 'AKIAABCD', '1234567890-abc', 'qq77', 'zz88', 'tt99', 'dXNlcjpwYXNz']) expect(out).not.toContain(leak);
    expect(out).toContain('&a=1');
  });

  it('strips zero-width characters that hide a key', () => {
    expect(redactString('sk-abc\u200Bdefghij12', [])).toBe('[REDACTED]');
  });
});

describe('short env secrets', () => {
  const env = { MY_API_KEY: 'abc123', PLAIN: 'visible1' };

  it('redacts a whole-token short env secret in free text only', () => {
    expect(promptText('use abc123 now, not abc1234 or xabc123', env)).toBe('use [REDACTED] now, not abc1234 or xabc123');
  });

  it('keeps ids, ts, type and JSON structure intact', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const written = handleHook({
      session_id: 'abc123', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'abc123',
      tool_input: { command: 'echo abc123' }, prompt_id: 'abc123', cwd: dir,
    }, { eventsPath, now, env });
    const parsed = JSON.parse(readFileSync(eventsPath, 'utf8')) as Record<string, unknown> & { payload: { raw: { tool_input: { command: string }; session_id: string } } };
    expect(parsed.id).toBe('abc123:abc123:pre');
    expect(parsed.session_id).toBe('abc123');
    expect(parsed.tool_use_id).toBe('abc123');
    expect(parsed.type).toBe('tool_call');
    expect(parsed.ts).toBe('2026-10-26T20:00:00.123Z');
    expect(parsed.payload.raw.session_id).toBe('abc123');
    expect(parsed.payload.raw.tool_input.command).toBe('echo [REDACTED]');
    expect(written?.id).toBe('abc123:abc123:pre');
  });
});

describe('split secrets', () => {
  it('masks a key split between stdout and stderr, including the joined output', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    handleHook({
      session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'key sk-abcdEFGH', stderr: 'd4E5f6G7h8I9j0 end' }, cwd: dir,
    }, { eventsPath, now, env: {} });
    const text = readFileSync(eventsPath, 'utf8');
    expect(text).not.toContain('d4E5f6G7h8I9j0');
    expect(text).not.toContain('abcdEFGH');
    expect(text).toContain(' end');
  });
});

describe('hook cli', () => {
  const script = path.join(__dirname, 'hook.ts');
  const tsx = path.join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  it.each(['[1,2]', '"text"', '7', 'null'])('prints one line and exits 0 for non-object JSON %s', (stdin) => {
    const result = spawnSync(process.execPath, [tsx, script], { input: stdin, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe('devlens hook: payload was not an object');
  });
});

describe('hook mapping', () => {
  it('maps prompt, tool pair, edit, stop, and skips session start', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const opts = { eventsPath, now, env: {} };
    expect(handleHook({ hook_event_name: 'SessionStart', session_id: 'ses_1', cwd: dir }, opts)).toBeNull();
    const prompt = handleHook({
      hook_event_name: 'UserPromptSubmit', session_id: 'ses_1', prompt_id: 'p1', prompt: 'hi', cwd: dir,
    }, opts);
    const pre = handleHook({
      hook_event_name: 'PreToolUse', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: 'toolu_1',
      tool_input: { command: 'npm test' }, cwd: dir,
    }, opts);
    const edit = handleHook({
      hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Edit', tool_use_id: 'toolu_2',
      tool_input: { file_path: 'lib.mjs', old_string: 'a - b', new_string: 'a + b' },
      tool_response: { filePath: 'lib.mjs', originalFile: 'SECRET_FILE_BODY', oldString: 'a - b', newString: 'a + b' },
      cwd: dir,
    }, opts);
    const stop = handleHook({ hook_event_name: 'Stop', session_id: 'ses_1', prompt_id: 'p1', cwd: dir }, opts);
    const end = handleHook({ hook_event_name: 'SessionEnd', session_id: 'ses_1', prompt_id: 'p1', cwd: dir }, opts);
    expect(prompt).toMatchObject({
      id: 'ses_1:UserPromptSubmit:p1', actor: 'developer', type: 'prompt', seq: 1,
      provenance: 'observed', recording_ref: null, media_offset_ms: null, tool_use_id: null,
      ts: '2026-10-26T20:00:00.123Z',
    });
    expect(pre).toMatchObject({ id: 'ses_1:toolu_1:pre', actor: 'agent', type: 'tool_call', tool_use_id: 'toolu_1', seq: 2 });
    expect(pre?.payload.phase).toBe('pre');
    expect(edit).toMatchObject({ id: 'ses_1:toolu_2:post', type: 'file_edit', seq: 3 });
    expect(edit?.payload.files).toEqual(['lib.mjs']);
    expect(JSON.stringify(edit)).not.toContain('SECRET_FILE_BODY');
    expect(stop).toMatchObject({ id: 'ses_1:Stop:p1', type: 'stop', seq: 4 });
    expect(end?.payload.hook_event_name).toBe('SessionEnd');
    expect(end?.id).toBe('ses_1:SessionEnd:p1');
  });

  it('marks every line of a multi-line edit diff with + or -', () => {
    const base = { hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Edit', tool_use_id: 't1', cwd: '/tmp' };
    const edit = mapHook({ ...base, tool_input: { file_path: 'a.js', old_string: 'one\ntwo', new_string: 'x\ny\nz' } }, now.toISOString(), 'p');
    expect(edit?.payload.diff).toBe('-one\n-two\n+x\n+y\n+z');
    const multi = mapHook({ ...base, tool_name: 'MultiEdit', tool_input: { file_path: 'a.js', edits: [{ old_string: 'a', new_string: 'b\nc' }] } }, now.toISOString(), 'p');
    expect(multi?.payload.diff).toBe('-a\n+b\n+c');
    const write = mapHook({ ...base, tool_name: 'Write', tool_input: { file_path: 'a.js', content: 'p\nq\nr' } }, now.toISOString(), 'p');
    expect(write?.payload.diff).toBe('+p\n+q\n+r');
    const big = mapHook({ ...base, tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'b'.repeat(4000) } }, now.toISOString(), 'p');
    expect(big?.payload.diff).toBeUndefined();
  });

  it('does not sign a trailing newline as an empty line', () => {
    const base = { hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Edit', tool_use_id: 't1', cwd: '/tmp' };
    const edit = mapHook({ ...base, tool_input: { file_path: 'a.js', old_string: 'o\n', new_string: 'p\nq\n' } }, now.toISOString(), 'p');
    expect(edit?.payload.diff).toBe('-o\n+p\n+q');
  });

  it('redacts a multi-line env secret inside a signed diff', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const secret = 'multiline-secret-AAAA\nmultiline-secret-BBBB';
    const event = handleHook({
      hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Edit', tool_use_id: 't9', cwd: dir,
      tool_input: { file_path: 'a.js', old_string: 'x', new_string: `k = ${secret}\nrest` },
    }, { eventsPath, now, env: { SUPABASE_SECRET_KEY: secret } });
    const text = readFileSync(eventsPath, 'utf8');
    expect(text).not.toContain('multiline-secret-AAAA');
    expect(text).not.toContain('multiline-secret-BBBB');
    expect(String(event?.payload.diff)).toContain('[REDACTED]');
  });

  it('redacts a short multi-line env secret in Edit, MultiEdit and Write text', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const env = { MY_API_KEY: 'ab\ncd' }; // 5 characters: a short secret (4 to 7), not a long one
    const base = { hook_event_name: 'PostToolUse', session_id: 'ses_1', cwd: dir };
    const events = [
      handleHook({ ...base, tool_name: 'Edit', tool_use_id: 's1', tool_input: { file_path: 'a.js', old_string: 'x', new_string: 'k=ab\ncd' } }, { eventsPath, now, env }),
      handleHook({ ...base, tool_name: 'Edit', tool_use_id: 's2', tool_input: { file_path: 'a.js', old_string: 'k=ab\ncd', new_string: 'y' } }, { eventsPath, now, env }),
      handleHook({ ...base, tool_name: 'MultiEdit', tool_use_id: 's3', tool_input: { file_path: 'a.js', edits: [{ old_string: 'x', new_string: 'ab\ncd' }] } }, { eventsPath, now, env }),
      handleHook({ ...base, tool_name: 'Write', tool_use_id: 's4', tool_input: { file_path: 'a.js', content: 'v=ab\ncd' } }, { eventsPath, now, env }),
    ];
    for (const event of events) {
      const diff = String(event?.payload.diff);
      expect(diff).toContain('[REDACTED]');
      expect(diff).not.toMatch(/^[+-].*\bab$/m);
      expect(diff).not.toMatch(/^[+-]cd\b/m);
    }
  });

  it('keeps test classification when an env value is a common word', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const run = (id: string, env: Record<string, string>) => handleHook({
      hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: id, cwd: dir,
      tool_input: { command: 'npm test' }, tool_response: { stdout: '✔ adds\nℹ pass 1\nℹ fail 0', stderr: '' },
    }, { eventsPath, now, env });
    expect(run('r1', { MY_API_KEY: 'test' })).toMatchObject({ type: 'test', payload: { status: 'passed' } });
    expect(run('r2', { MY_PASSWORD: 'pass' })).toMatchObject({ type: 'test', payload: { status: 'passed' } });
  });

  it('classifies test hooks without inventing an exit code', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const opts = { eventsPath, now, env: {} };
    const failed = handleHook({
      hook_event_name: 'PostToolUseFailure', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: 'toolu_f',
      tool_input: { command: 'npm test' }, error: 'Exit code 1\n\n✖ adds\nℹ fail 1', cwd: dir,
    }, opts);
    const parsed = handleHook({
      hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: 'toolu_p',
      tool_input: { command: 'npm test 2>&1 | tail -30' },
      tool_response: { stdout: '✖ adds\nℹ fail 1\nℹ pass 0', stderr: '' }, cwd: dir,
    }, opts);
    const passed = handleHook({
      hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: 'toolu_ok',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: '✔ adds\nℹ pass 1\nℹ fail 0', stderr: '' }, cwd: dir,
    }, opts);
    const unknown = handleHook({
      hook_event_name: 'PostToolUse', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: 'toolu_u',
      tool_input: { command: 'npx vitest' }, tool_response: { stdout: '', stderr: '' }, cwd: dir,
    }, opts);
    const other = handleHook({
      hook_event_name: 'PostToolUseFailure', session_id: 'ses_1', tool_name: 'Bash', tool_use_id: 'toolu_o',
      tool_input: { command: 'ls' }, error: 'Exit code 1', cwd: dir,
    }, opts);
    expect(failed?.type).toBe('test');
    expect(failed?.payload).toMatchObject({ status: 'failed', signal: 'hook_failure', command: 'npm test' });
    expect(failed?.payload).not.toHaveProperty('exit_code');
    expect(failed?.payload).not.toHaveProperty('files');
    expect(parsed?.payload).toMatchObject({ status: 'failed', signal: 'output_parse' });
    expect(passed?.payload).toMatchObject({ status: 'passed', signal: 'output_parse' });
    expect(unknown?.payload).toMatchObject({ status: 'unknown', signal: 'output_parse', command: 'npx vitest' });
    expect(testStatusFromOutput('======= 1 failed, 1 passed in 0.01s =======')).toBe('failed');
    expect(testStatusFromOutput('======= 2 passed in 0.01s =======')).toBe('passed');
    expect(testStatusFromOutput('Tests  1 passed (1)')).toBe('passed');
    expect(testStatusFromOutput('no summary here')).toBe('unknown');
    expect(other?.payload).toMatchObject({ phase: 'failure' });
    expect(other?.type).toBe('tool_call');
    expect(JSON.stringify(unknown)).not.toContain('exit_code');
  });

  it('reads cargo test output (EVAL-4) and keeps node, vitest, and pytest results', () => {
    const lib = 'running 1 test\ntest tests::adds ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n';
    const doc = '   Doc-tests tiny\n\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n';
    expect(testStatusFromOutput(lib)).toBe('passed');
    expect(testStatusFromOutput(`${lib}\n     Running tests/api.rs\n\n${lib}\n${doc}`)).toBe('passed');
    expect(testStatusFromOutput(doc)).toBe('unknown');
    expect(testStatusFromOutput(`${lib}\ntest t::bad ... FAILED\n\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\nerror: test failed, to rerun pass \`--lib\`\n`)).toBe('failed');
    expect(testStatusFromOutput('test result: FAILED. 0 passed; 0 failed; 0 ignored')).toBe('failed');
    expect(testStatusFromOutput('error[E0308]: mismatched types\n --> src/lib.rs:1:21\n\nFor more information about this error, try `rustc --explain E0308`.\nerror: could not compile `f` (lib) due to 1 previous error\n')).toBe('failed');
    expect(testStatusFromOutput('error[E0425]: cannot find value `x` in this scope\n --> src/lib.rs:2:5\n')).toBe('failed');
    // A passing trybuild-style test may print an expected compiler error. The summary line decides.
    expect(testStatusFromOutput(`error[E0308]: expected mismatch (from a ui test)\n${lib}`)).toBe('passed');
    // Review finding 7: a passing run that prints the compile-failure line (a ui test) is still decided by its summary.
    expect(testStatusFromOutput(`error: could not compile \`ui_case\` (expected)\n${lib}`)).toBe('passed');
    expect(testStatusFromOutput('ℹ tests 2\nℹ pass 2\nℹ fail 0')).toBe('passed');
    expect(testStatusFromOutput('ℹ pass 1\nℹ fail 1')).toBe('failed');
    expect(testStatusFromOutput(' Tests  1 failed | 2 passed (3)')).toBe('failed');
    expect(testStatusFromOutput(' Test Files  3 passed (3)\n      Tests  12 passed (12)')).toBe('passed');
    expect(testStatusFromOutput('======= 3 passed, 1 warning in 0.20s =======')).toBe('passed');
  });

  it('keeps missing ids unknown and does not read a dotenv file from the hook', () => {
    const dir = tempDir();
    const eventsPath = path.join(dir, 'events.jsonl');
    const event = handleHook({ hook_event_name: 'UserPromptSubmit', cwd: dir }, { eventsPath, now, env: {} });
    expect(event).toMatchObject({
      id: 'unknown:UserPromptSubmit:unknown',
      session_id: 'unknown',
      tool_use_id: null,
    });
    expect(event?.payload.prompt).toBeNull();
    expect(event?.payload.prompt_id).toBeNull();
    const sources = ['hook.ts', 'handle.ts', 'redact.ts', 'map-hook.ts', 'append-event.ts'].map((name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')).join('\n');
    expect(sources).not.toMatch(/loadEnvFile|['"`]\.env['"`]/);
  });
});

describe('devlens init', () => {
  it('merges project-local hooks, prints the notice, and is idempotent', () => {
    const dir = tempDir();
    const settingsPath = path.join(dir, '.claude', 'settings.local.json');
    const beforeHome = homeSettingsSnapshot();
    const lines: string[] = [];
    init(dir, (line) => lines.push(line));
    const first = readFileSync(settingsPath, 'utf8');
    init(dir, () => {});
    expect(readFileSync(settingsPath, 'utf8')).toBe(first);
    const settings = JSON.parse(first) as { permissions?: { allow: string[] }; hooks: Record<string, { hooks: { type: string; args: string[] }[] }[]> };
    expect(lines.join('\n')).toBe(CONSENT_NOTICE);
    expect(CONSENT_NOTICE).toContain('The window the developer picks');
    expect(CONSENT_NOTICE).toContain('Do not record anyone else.');
    expect(HOOK_EVENTS).not.toContain('SessionStart');
    expect(Object.keys(settings.hooks)).not.toContain('SessionStart');
    for (const eventName of HOOK_EVENTS) {
      const handlers = settings.hooks[eventName].flatMap((group) => group.hooks);
      expect(handlers.filter((handler) => isDevlensHandler(handler))).toHaveLength(1);
    }
    const kept = path.join(dir, '.claude', 'settings.local.json');
    const existing = {
      permissions: { allow: ['Bash'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    };
    writeFileSync(kept, `${JSON.stringify(existing, null, 2)}\n`);
    init(dir, () => {});
    init(dir, () => {});
    const mergedText = readFileSync(kept, 'utf8');
    const again = init(dir, () => {});
    expect(readFileSync(again, 'utf8')).toBe(mergedText);
    const merged = JSON.parse(mergedText) as { permissions: { allow: string[] }; hooks: Record<string, { matcher?: string; hooks: { command?: string; args?: string[] }[] }[]> };
    expect(merged.permissions.allow).toEqual(['Bash']);
    const userHook = merged.hooks.PreToolUse.find((group) => group.matcher === 'Bash');
    expect(userHook?.hooks[0]?.command).toBe('echo hi');
    expect(homeSettingsSnapshot()).toBe(beforeHome);
    expect(mergedText).not.toContain(path.join(homedir(), '.claude'));
  });
});
