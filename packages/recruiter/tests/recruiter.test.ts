import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Event } from '../../core/event';
import { bannedReason } from '../../agent/src/validate';
import { applyRecruiterPost, readRecruiterState } from '../src/api';
import { buildEntry, testCounts } from '../src/build';
import { gapMinutes, maybeSendUpdate, readEntries, recruiterPath } from '../src/store';

const SESSION = 's1';
const T0 = Date.parse('2026-10-28T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);

function ev(id: string, min: number, actor: Event['actor'], type: Event['type'], payload: Record<string, unknown>, extra: Partial<Event> = {}): Event {
  return { id, session_id: SESSION, project_id: 'demo', ts: at(min).toISOString(), seq: 0, actor, type, source: 'claude_code_hook', provenance: 'observed', recording_ref: null, media_offset_ms: null, payload, ...extra };
}

const DIFF = '-  return a - b;\n+  return a + b; // SECRET_DIFF_TEXT';
const FILE_TEXT = 'export const hidden = "FILE_BODY_TEXT";';
const OUTPUT_FAIL = 'FAIL tests/sum.test.js\nAssertionError: OUTPUT_BODY_TEXT\n Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)';
const OUTPUT_PASS = 'OUTPUT_BODY_TEXT ok\n Test Files  1 passed (1)\n      Tests  4 passed (4)';

function session(): Event[] {
  return [
    ev('s1:UserPromptSubmit:p1', 1, 'developer', 'prompt', { prompt: 'Make the sum endpoint return the right total' }),
    ev('s1:t1:post', 2, 'agent', 'test', { status: 'failed', command: 'npx vitest run', output: OUTPUT_FAIL, signal: 'output_parse' }),
    ev('s1:e1:post', 3, 'agent', 'file_edit', { files: ['/Users/someone/project/src/sum.js', 'src/lib/util.js'], diff: DIFF, tool_name: 'Edit', raw: { tool_input: { content: FILE_TEXT } } }),
    ev('s1:t2:post', 4, 'agent', 'test', { status: 'passed', command: 'npx vitest run', output: OUTPUT_PASS, signal: 'output_parse' }),
    ev('s1:devlens_question:s1:Stop:p1', 5, 'tool', 'question', { text: 'Why the sum route?', cites: ['s1:UserPromptSubmit:p1'] }, { source: 'devlens_question', provenance: 'inferred' }),
    ev('s1:devlens_question:s1:Stop:p1:answer', 6, 'developer', 'answer', { question_id: 's1:devlens_question:s1:Stop:p1', text: 'Because it broke.', action: 'answer' }, { source: 'devlens_question' }),
    ev('s1:UserPromptSubmit:p2', 7, 'developer', 'prompt', { prompt: 'Now add a total for the list view, my key is sk-ant-abcdefghijklmnop12345 thanks' }),
  ];
}

function project(opts: { sharing?: string; events?: Event[] } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-recruiter-'));
  mkdirSync(path.join(dir, '.devlens'));
  if (opts.sharing !== undefined) writeFileSync(path.join(dir, '.devlens', 'share.json'), opts.sharing);
  writeFileSync(path.join(dir, '.devlens', 'events.jsonl'), (opts.events ?? session()).map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

const appendEvents = (dir: string, events: Event[]) =>
  writeFileSync(path.join(dir, '.devlens', 'events.jsonl'), readFileSync(path.join(dir, '.devlens', 'events.jsonl'), 'utf8') + events.map((e) => JSON.stringify(e)).join('\n') + '\n');

describe('buildEntry (pure rules)', () => {
  it('builds each fact line in the fixed format and cites only real event ids', () => {
    const events = session();
    const entry = buildEntry(events, null, 'update', { now: at(8), id: 'u1' });
    expect(entry).not.toBeNull();
    expect(entry!.lines.map((line) => line.text)).toEqual([
      'Working on: "Now add a total for the list view, my key is [REDACTED] thanks"',
      '2 developer prompts',
      'Files changed: sum.js, util.js',
      'Tests: 1 failing → 4 passing',
      'Agent questions: 1 asked, 1 answered',
    ]);
    const ids = new Set(events.map((e) => e.id));
    for (const line of entry!.lines) {
      expect(line.cites.length).toBeGreaterThan(0);
      for (const cite of line.cites) expect(ids.has(cite)).toBe(true);
    }
    expect(entry!.lines[0].cites).toEqual(['s1:UserPromptSubmit:p2']);
    expect(entry!.lines[3].cites).toEqual(['s1:t1:post', 's1:t2:post']);
  });

  it('never holds a diff, file text, tool output text, or a full path', () => {
    const json = JSON.stringify(buildEntry(session(), null, 'status', { now: at(8) }));
    for (const leak of ['SECRET_DIFF_TEXT', 'return a', 'FILE_BODY_TEXT', 'OUTPUT_BODY_TEXT', 'AssertionError', '/Users/someone', 'src/lib', 'sk-ant-']) expect(json).not.toContain(leak);
  });

  it('quotes at most 120 characters of the latest prompt, flattened and redacted', () => {
    const long = `GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 then\n\n${'word '.repeat(60)}`;
    const entry = buildEntry([ev('p', 1, 'developer', 'prompt', { prompt: long })], null, 'update', { now: at(2) })!;
    const quote = /^Working on: "(.*)"$/.exec(entry.lines[0].text)![1];
    expect(quote.startsWith('GITHUB_TOKEN=[REDACTED] then word')).toBe(true);
    expect(quote).not.toContain('\n');
    expect([...quote.replace(/…$/, '')].length).toBe(120);
    expect(quote.endsWith('…')).toBe(true);
  });

  it('uses env secrets through the redact option', () => {
    const entry = buildEntry([ev('p', 1, 'developer', 'prompt', { prompt: 'use hunter2-long-value here' })], null, 'update', { now: at(2), redact: (t) => t.split('hunter2-long-value').join('[REDACTED]') })!;
    expect(entry.lines[0].text).toBe('Working on: "use [REDACTED] here"');
  });

  it('keeps "fix" inside the quoted developer prompt, but never score, rank, or hire', () => {
    const entry = buildEntry([ev('p1', 1, 'developer', 'prompt', { prompt: 'Fix the failing pagination test' })], null, 'update', { now: at(2) })!;
    expect(entry.lines.map((l) => l.text)).toEqual(['Working on: "Fix the failing pagination test"', '1 developer prompt']);
    const graded = buildEntry([ev('p1', 1, 'developer', 'prompt', { prompt: 'Grade my fix' })], null, 'update', { now: at(2) })!;
    expect(graded.lines.map((l) => l.text)).toEqual(['1 developer prompt']);
  });

  it('redacts env secret values from the prompt quote on the real send path', () => {
    const secret = 'zq9-longsecretvalue-4471';
    const dir = project({ sharing: '{"enabled":true}', events: [ev('s1:UserPromptSubmit:p1', 1, 'developer', 'prompt', { prompt: `deploy with ${secret} now` })] });
    const sent = maybeSendUpdate(dir, SESSION, { env: { DEVLENS_UPDATE_EVERY_MIN: '0', MY_API_KEY: secret }, now: at(2) }).sent!;
    expect(sent.lines[0].text).toBe('Working on: "deploy with [REDACTED] now"');
    expect(readFileSync(recruiterPath(dir), 'utf8')).not.toContain(secret);
  });

  it('drops any line that matches the score, rank, hire, or fix filter, and keeps the rest', () => {
    const events = [
      ev('p1', 1, 'developer', 'prompt', { prompt: 'Please fix the ranking bug' }),
      ev('e1', 2, 'agent', 'file_edit', { files: ['fix-login.js', 'app.js'] }),
    ];
    const entry = buildEntry(events, null, 'update', { now: at(3) })!;
    expect(entry.lines.map((l) => l.text)).toEqual(['1 developer prompt', 'Files changed: app.js']);
    for (const line of entry.lines) expect(bannedReason(line.text)).toBeNull();
  });

  it('no line in a full status matches the banned filter', () => {
    const entry = buildEntry(session(), null, 'status', { now: at(8) })!;
    expect(entry.lines.length).toBeGreaterThan(0);
    for (const line of entry.lines) expect(bannedReason(line.text)).toBeNull();
  });

  it('returns no update when there is no new developer prompt since the last entry', () => {
    expect(buildEntry(session(), at(7).toISOString(), 'update', { now: at(8) })).toBeNull();
    expect(buildEntry([], null, 'update', { now: at(8) })).toBeNull();
    const since = buildEntry(session(), at(6).toISOString(), 'update', { now: at(8) })!;
    expect(since.since).toBe(at(6).toISOString());
    expect(since.lines.map((l) => l.text)).toEqual(['Working on: "Now add a total for the list view, my key is [REDACTED] thanks"', '1 developer prompt']);
  });

  it('a status covers the whole session and ends with the last activity time', () => {
    const entry = buildEntry(session(), null, 'status', { now: at(8) })!;
    expect(entry.kind).toBe('status');
    expect(entry.lines.at(-1)).toEqual({ text: 'Last activity: 2026-10-28T10:07:00Z', cites: ['s1:UserPromptSubmit:p2'] });
    expect(buildEntry([], null, 'status', { now: at(8) })!.lines).toEqual([]);
  });

  it('reads counts from vitest, jest, node:test, and pytest output, otherwise uses the status word', () => {
    expect(testCounts(' Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)')).toEqual({ failed: 1, passed: 3 });
    expect(testCounts('Tests:       2 failed, 5 passed, 7 total')).toEqual({ failed: 2, passed: 5 });
    expect(testCounts('ℹ tests 4\nℹ pass 4\nℹ fail 0')).toEqual({ failed: 0, passed: 4 });
    expect(testCounts('==== 1 failed, 9 passed in 0.3s ====')).toEqual({ failed: 1, passed: 9 });
    const words = buildEntry([
      ev('p', 1, 'developer', 'prompt', { prompt: 'go' }),
      ev('t1', 2, 'agent', 'test', { status: 'failed', output: '' }),
      ev('t2', 3, 'agent', 'test', { status: 'unknown', output: '' }),
    ], null, 'update', { now: at(4) })!;
    expect(words.lines.find((l) => l.text.startsWith('Tests:'))!.text).toBe('Tests: failing → status unknown');
  });
});

describe('store and Stop trigger', () => {
  const env = { DEVLENS_UPDATE_EVERY_MIN: '10' };

  it('with sharing on and the gap passed, appends one update that cites real ids', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    const result = maybeSendUpdate(dir, SESSION, { env, now: at(8) });
    expect(result.skipped).toBeNull();
    const entries = readEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('update');
    expect(entries[0].since).toBeNull();
    const ids = new Set(session().map((e) => e.id));
    for (const line of entries[0].lines) for (const cite of line.cites) expect(ids.has(cite)).toBe(true);
    const raw = readFileSync(recruiterPath(dir), 'utf8');
    for (const leak of ['SECRET_DIFF_TEXT', 'FILE_BODY_TEXT', 'OUTPUT_BODY_TEXT', 'sk-ant-']) expect(raw).not.toContain(leak);
  });

  it.each([
    ['missing file', undefined],
    ['enabled false', '{"enabled":false}'],
    ['bad JSON', '{nope'],
    ['enabled not true', '{"enabled":"yes"}'],
  ])('sends nothing with sharing off (%s)', (_name, sharing) => {
    const dir = project({ sharing });
    expect(maybeSendUpdate(dir, SESSION, { env, now: at(8) })).toEqual({ sent: null, skipped: 'sharing_off' });
    expect(existsSync(recruiterPath(dir))).toBe(false);
  });

  it('sends nothing inside the gap, then sends once the gap passes and a new prompt exists', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    expect(maybeSendUpdate(dir, SESSION, { env, now: at(8) }).sent).not.toBeNull();
    appendEvents(dir, [ev('s1:UserPromptSubmit:p3', 9, 'developer', 'prompt', { prompt: 'Next step' })]);
    expect(maybeSendUpdate(dir, SESSION, { env, now: at(12) }).skipped).toBe('inside_gap');
    const later = maybeSendUpdate(dir, SESSION, { env, now: at(19) });
    expect(later.sent?.since).toBe(at(8).toISOString());
    expect(later.sent?.lines.map((l) => l.text)).toEqual(['Working on: "Next step"', '1 developer prompt']);
    expect(readEntries(dir)).toHaveLength(2);
  });

  it('sends nothing with no new developer prompt since the last entry, even after the gap', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    maybeSendUpdate(dir, SESSION, { env, now: at(8) });
    appendEvents(dir, [ev('s1:t3:post', 9, 'agent', 'test', { status: 'passed', output: '' })]);
    expect(maybeSendUpdate(dir, SESSION, { env, now: at(30) }).skipped).toBe('no_new_prompt');
    expect(readEntries(dir)).toHaveLength(1);
  });

  it('a gap of 0 sends at every eligible Stop; a bad value uses 10 minutes', () => {
    expect(gapMinutes({})).toBe(10);
    expect(gapMinutes({ DEVLENS_UPDATE_EVERY_MIN: '0' })).toBe(0);
    expect(gapMinutes({ DEVLENS_UPDATE_EVERY_MIN: '-3' })).toBe(10);
    expect(gapMinutes({ DEVLENS_UPDATE_EVERY_MIN: 'soon' })).toBe(10);
    const dir = project({ sharing: '{"enabled":true}' });
    const zero = { DEVLENS_UPDATE_EVERY_MIN: '0' };
    maybeSendUpdate(dir, SESSION, { env: zero, now: at(8) });
    appendEvents(dir, [ev('s1:UserPromptSubmit:p3', 8.5, 'developer', 'prompt', { prompt: 'again' })]);
    expect(maybeSendUpdate(dir, SESSION, { env: zero, now: at(9) }).sent).not.toBeNull();
  });

  it('a second Stop at the same moment appends nothing', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    const first = maybeSendUpdate(dir, SESSION, { env: { DEVLENS_UPDATE_EVERY_MIN: '0' }, now: at(8) });
    const second = maybeSendUpdate(dir, SESSION, { env: { DEVLENS_UPDATE_EVERY_MIN: '0' }, now: at(8) });
    expect(first.sent).not.toBeNull();
    expect(second).toEqual({ sent: null, skipped: 'no_new_prompt' });
    expect(readEntries(dir)).toHaveLength(1);
  });

  it('while another writer holds the lock, appends nothing', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    writeFileSync(`${recruiterPath(dir)}.lock`, '');
    expect(maybeSendUpdate(dir, SESSION, { env, now: at(8) })).toEqual({ sent: null, skipped: 'recruiter_locked' });
    expect(existsSync(recruiterPath(dir))).toBe(false);
  });

  it('only counts the given session', () => {
    const other = session().map((e) => ({ ...e, session_id: 's2', id: `x-${e.id}` }));
    const dir = project({ sharing: '{"enabled":true}', events: other });
    expect(maybeSendUpdate(dir, SESSION, { env, now: at(8) }).skipped).toBe('no_new_prompt');
  });
});

describe('recruiter API', () => {
  it('request_status appends one status entry built from the events so far and returns it', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    const result = applyRecruiterPost(dir, { type: 'request_status' }, {}, at(8));
    expect(result.status).toBe(200);
    const entry = result.body.entry as { id: string; kind: string; lines: { text: string }[] };
    expect(entry.kind).toBe('status');
    expect(entry.lines.map((l) => l.text)).toContain('Tests: 1 failing → 4 passing');
    const stored = readEntries(dir);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(entry);
    expect(readRecruiterState(dir).updates[0].id).toBe(entry.id);
  });

  it('request_status with sharing off is 409 sharing_off and appends nothing', () => {
    const dir = project();
    expect(applyRecruiterPost(dir, { type: 'request_status' }, {}, at(8))).toEqual({ status: 409, body: { error: 'sharing_off' } });
    expect(existsSync(recruiterPath(dir))).toBe(false);
  });

  it('GET returns sharing, project, and updates newest first; sharing off shows none', () => {
    const dir = project({ sharing: '{"enabled":true}' });
    maybeSendUpdate(dir, SESSION, { env: {}, now: at(8) });
    applyRecruiterPost(dir, { type: 'request_status' }, {}, at(9));
    const state = readRecruiterState(dir);
    expect(state.sharing).toBe(true);
    expect(state.project).toBe(path.basename(dir));
    expect(state.updates.map((u) => u.kind)).toEqual(['status', 'update']);
    expect(applyRecruiterPost(dir, { type: 'share', enabled: false })).toEqual({ status: 200, body: { sharing: false } });
    expect(readRecruiterState(dir)).toEqual({ available: true, sharing: false, project: path.basename(dir), updates: [] });
  });

  it('share writes share.json, which turns sharing on', () => {
    const dir = project();
    expect(applyRecruiterPost(dir, { type: 'share', enabled: true }).status).toBe(200);
    expect(JSON.parse(readFileSync(path.join(dir, '.devlens', 'share.json'), 'utf8'))).toEqual({ enabled: true });
    expect(readRecruiterState(dir).sharing).toBe(true);
  });

  it.each([
    [null], [[]], ['text'], [{}], [{ type: 'nope' }], [{ type: 'share' }], [{ type: 'share', enabled: 'yes' }],
  ])('rejects an unknown or bad body with 400 (%j)', (body) => {
    expect(applyRecruiterPost(project(), body).status).toBe(400);
  });

  it('without DEVLENS_PROJECT_DIR: GET is unavailable and POST is 503', () => {
    expect(readRecruiterState(null)).toEqual({ available: false, sharing: false, project: null, updates: [] });
    expect(applyRecruiterPost(null, { type: 'request_status' }).status).toBe(503);
  });
});
