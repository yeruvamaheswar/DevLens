import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Event } from '../../core/event';
import { adapt, gitManifestReader, startAdapter, type AdapterState, type ManifestReader } from '../src/adapter';
import { startLive, step } from '../src/live';
import type { LiveInput, LiveState } from '../src/types';

const START = 1_700_000_000_000;
const SESSION = 's1';
const iso = (min: number) => new Date(START + min * 60_000).toISOString();
const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'x', dependencies: deps }, null, 2);

function edit(id: string, file: string, min: number, diff?: string): Event {
  return {
    id, session_id: SESSION, project_id: 'p', ts: iso(min), seq: 0, actor: 'agent', type: 'file_edit', source: 'claude_code_hook',
    provenance: 'observed', recording_ref: null, media_offset_ms: null,
    payload: { files: [file], tool_name: 'Edit', ...(diff ? { diff } : {}) },
  };
}
function stopEvent(id: string, min: number, hook: 'Stop' | 'SessionEnd' = 'Stop'): Event {
  return {
    id, session_id: SESSION, project_id: 'p', ts: iso(min), seq: 0, actor: 'agent', type: 'stop', source: 'claude_code_hook',
    provenance: 'observed', recording_ref: null, media_offset_ms: null, payload: { hook_event_name: hook },
  };
}
function fakeReader(head: Record<string, string>, work: Record<string, string>): ManifestReader {
  return { atHead: (p) => head[p] ?? null, now: (p) => work[p] ?? null };
}
// Feeds events through the adapter, then the inputs through the live scheduler.
function drive(events: Event[], reader: ManifestReader, adapter: AdapterState = startAdapter(SESSION), live: LiveState = startLive(SESSION, START)) {
  const inputs: LiveInput[] = [];
  const asked: string[] = [];
  for (const event of events) {
    const out = adapt(adapter, event, reader);
    adapter = out.state;
    for (const input of out.inputs) {
      inputs.push(input);
      const result = step(live, input);
      live = result.state;
      if (result.ask) asked.push(result.ask.question.id);
    }
  }
  return { inputs, asked, adapter, live };
}
const kinds = (inputs: LiveInput[]) => inputs.map((i) => i.kind);

describe('adapter rules', () => {
  it('asks the react question at the next Stop, naming Vue and Angular', () => {
    const reader = fakeReader({ 'package.json': pkg({}) }, { 'package.json': pkg({ react: '^19' }) });
    const out = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], reader);
    expect(kinds(out.inputs)).toEqual(['questions', 'stop']);
    const q = out.inputs.find((i) => i.kind === 'questions');
    expect(q && q.kind === 'questions' && q.questions[0].text).toContain('Vue or Angular');
    expect(q && q.kind === 'questions' && q.questions[0].evidence_event_ids).toEqual(['e1']);
    expect(out.asked).toEqual([`${SESSION}:choice:react`]);
  });

  it('asks nothing for react-dom after react: the snapshot and the dedupe hold', () => {
    const work = { 'package.json': pkg({ react: '^19' }) };
    const reader: ManifestReader = { atHead: () => pkg({}), now: (p) => work[p as 'package.json'] ?? null };
    const first = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], reader);
    work['package.json'] = pkg({ react: '^19', 'react-dom': '^19' });
    const second = drive([edit('e2', 'package.json', 6), stopEvent('stop2', 7)], reader, first.adapter, first.live);
    expect(kinds(second.inputs)).toEqual(['stop']);
    expect(first.adapter.snapshots['package.json']).toBe(pkg({ react: '^19' }));
  });

  it('compares the second Stop with the first Stop, not with HEAD', () => {
    const work = { 'package.json': pkg({ vitest: '^5' }) };
    const reader: ManifestReader = { atHead: () => pkg({}), now: (p) => work[p as 'package.json'] ?? null };
    const first = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], reader);
    work['package.json'] = pkg({ vitest: '^5', zustand: '^5' });
    const second = drive([edit('e2', 'package.json', 6), stopEvent('stop2', 7)], reader, first.adapter, first.live);
    const q = second.inputs.find((i) => i.kind === 'questions');
    expect(q && q.kind === 'questions' && q.questions.map((x) => x.option_id)).toEqual(['zustand']);
  });

  it('emits only stop for a Stop with no manifest edit, plus diff when edits had diffs', () => {
    const reader = fakeReader({}, {});
    expect(kinds(drive([stopEvent('stop1', 5)], reader).inputs)).toEqual(['stop']);
    const out = drive([edit('e1', 'src/a.ts', 4, '- const a = 1\n+ const a = useQuery()'), stopEvent('stop1', 5)], reader);
    expect(kinds(out.inputs)).toEqual(['diff', 'stop']);
    const diff = out.inputs[0];
    expect(diff.kind === 'diff' && diff.files).toEqual([{ file: 'src/a.ts', added: [' const a = useQuery()'] }]);
    expect(diff.kind === 'diff' && diff.event_ids).toEqual(['e1']);
  });

  it('asks nothing when the manifest content is unchanged', () => {
    const same = pkg({ react: '^19' });
    const out = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], fakeReader({ 'package.json': same }, { 'package.json': same }));
    expect(kinds(out.inputs)).toEqual(['stop']);
  });

  it('saves the snapshot even when content is unchanged, so a later HEAD change cannot hide a dependency', () => {
    const head = { v: pkg({}) };
    const work = { v: pkg({}) };
    const reader: ManifestReader = { atHead: () => head.v, now: () => work.v };
    const first = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], reader);
    expect(first.adapter.snapshots['package.json']).toBe(pkg({}));
    work.v = pkg({ react: '^19' });
    head.v = pkg({ react: '^19' }); // committed before the Stop
    const second = drive([edit('e2', 'package.json', 6), stopEvent('stop2', 7)], reader, first.adapter, first.live);
    expect(kinds(second.inputs)).toEqual(['questions', 'stop']);
  });

  it('ignores files named like inherited object members', () => {
    const reader: ManifestReader = { atHead: () => 'x', now: () => 'y' };
    const edits = ['constructor', '__proto__', 'toString', 'a/constructor'].map((f, i) => edit(`e${i}`, f, 4));
    const out = drive([...edits, stopEvent('stop1', 5)], reader);
    expect(kinds(out.inputs)).toEqual(['stop']);
    expect(Object.keys(out.adapter.snapshots)).toEqual([]);
    // A manifest under a directory with such a name still works, and the snapshot key stays an own property.
    const manifest = '__proto__/package.json';
    const r2 = fakeReader({ [manifest]: pkg({}) }, { [manifest]: pkg({ react: '^19' }) });
    const out2 = drive([edit('e9', manifest, 4), stopEvent('stop2', 5)], r2);
    expect(kinds(out2.inputs)).toEqual(['questions', 'stop']);
    expect(Object.hasOwn(out2.adapter.snapshots, manifest)).toBe(true);
  });

  it('emits diff, then questions, then stop in one Stop, and does not mutate the input state', () => {
    const reader = fakeReader({ 'package.json': pkg({}) }, { 'package.json': pkg({ react: '^19' }) });
    const state: AdapterState = {
      ask: { session_id: SESSION, asked_option_ids: ['zod'], asked_categories: [] },
      pending: [edit('e1', 'package.json', 4, '- a\n+ "react": "^19"'), edit('e2', 'src/a.ts', 4)],
      snapshots: { 'other/package.json': pkg({}) },
    };
    const snapshot = JSON.stringify(state);
    const frozen = JSON.parse(snapshot) as AdapterState;
    const deepFreeze = (v: unknown): void => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } };
    deepFreeze(frozen);
    const out = adapt(frozen, stopEvent('stop1', 5), reader);
    expect(kinds(out.inputs)).toEqual(['diff', 'questions', 'stop']);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(out.state.pending).toEqual([]);
    expect(out.state.snapshots).toEqual({ 'other/package.json': pkg({}), 'package.json': pkg({ react: '^19' }) });
    expect(out.state.ask.asked_option_ids).toEqual(['zod', 'react']);
  });

  it('skips a deleted manifest', () => {
    const out = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], fakeReader({ 'package.json': pkg({}) }, {}));
    expect(kinds(out.inputs)).toEqual(['stop']);
  });

  it('turns a SessionEnd into session_end after the same flush', () => {
    const reader = fakeReader({ 'package.json': pkg({}) }, { 'package.json': pkg({ react: '^19' }) });
    const out = drive([edit('e1', 'package.json', 4), stopEvent('end1', 5, 'SessionEnd')], reader);
    expect(kinds(out.inputs)).toEqual(['questions', 'session_end']);
    expect(out.live.phase).toBe('ended');
    expect(out.live.questions[0].status).toBe('post_session');
  });

  it('ignores other event types and does not mutate the input state', () => {
    const state = startAdapter(SESSION);
    const frozen = Object.freeze({ ...state, pending: Object.freeze([]) as unknown as Event[] });
    const prompt = { ...stopEvent('p1', 1), type: 'prompt' as const };
    expect(adapt(frozen, prompt, fakeReader({}, {})).inputs).toEqual([]);
    const next = adapt(state, edit('e1', 'a.ts', 1), fakeReader({}, {}));
    expect(state.pending).toEqual([]);
    expect(next.state.pending).toHaveLength(1);
    expect(next.inputs).toEqual([]);
  });

  it('feeds diff lines to a follow-up after an answer names a term', () => {
    const reader = fakeReader({ 'package.json': pkg({}) }, { 'package.json': pkg({ react: '^19' }) });
    const first = drive([edit('e1', 'package.json', 4), stopEvent('stop1', 5)], reader);
    const answered = step(first.live, { kind: 'answer', question_id: `${SESSION}:choice:react`, text: 'I want `useQuery` for caching', at_ms: START + 6 * 60_000 }).state;
    const second = drive([edit('e2', 'src/a.ts', 7, '- x\n+ const d = useQuery(key)'), stopEvent('stop2', 8)], reader, first.adapter, answered);
    const follow = second.live.questions.find((q) => q.question.id === `${SESSION}:choice:react:follow`);
    expect(follow?.status).toBe('queued');
    expect(follow?.question.evidence_event_ids).toContain('e2');
  });

  it('detects a requirements.txt addition', () => {
    const reader = fakeReader({ 'requirements.txt': 'requests\n' }, { 'requirements.txt': 'requests\nfastapi\n' });
    const out = drive([edit('e1', 'requirements.txt', 4), stopEvent('stop1', 5)], reader);
    const q = out.inputs.find((i) => i.kind === 'questions');
    expect(q && q.kind === 'questions' && q.questions[0].option_id).toBe('fastapi');
  });

  it('gives every file of a multi-file edit the edit added lines', () => {
    const multi = edit('e1', 'a.ts', 4, '- x\n+ y');
    (multi.payload as { files: string[] }).files = ['a.ts', 'b.ts'];
    const out = drive([multi, edit('e2', 'a.ts', 4, '- p\n+ q'), stopEvent('stop1', 5)], fakeReader({}, {}));
    const diff = out.inputs[0];
    expect(diff.kind === 'diff' && diff.files).toEqual([{ file: 'a.ts', added: [' y', ' q'] }, { file: 'b.ts', added: [' y'] }]);
  });
});

describe('gitManifestReader', () => {
  const dirs: string[] = [];
  const temp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'adapter-test-'))); dirs.push(d); return d; };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('reads HEAD and the working tree, and returns null for unknown paths', () => {
    const repo = temp();
    git(repo, 'init', '-q');
    const reader0 = gitManifestReader(repo);
    expect(reader0.atHead('package.json')).toBeNull(); // no commits yet
    writeFileSync(join(repo, 'package.json'), pkg({}));
    mkdirSync(join(repo, 'sub'));
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    writeFileSync(join(repo, 'package.json'), pkg({ react: '^19' }));
    writeFileSync(join(repo, 'requirements.txt'), 'flask\n');
    const reader = gitManifestReader(join(repo, 'sub'));
    expect(reader.atHead(join(repo, 'package.json'))).toBe(pkg({}));
    expect(reader.atHead('package.json')).toBe(pkg({}));
    expect(reader.now(join(repo, 'package.json'))).toBe(pkg({ react: '^19' }));
    expect(reader.atHead(join(repo, 'requirements.txt'))).toBeNull(); // untracked
    expect(reader.now(join(repo, 'requirements.txt'))).toBe('flask\n');
    expect(reader.now(join(repo, 'gone.json'))).toBeNull();
    const outside = temp();
    writeFileSync(join(outside, 'package.json'), '{}');
    expect(reader.atHead(join(outside, 'package.json'))).toBeNull();
    expect(reader.now(join(outside, 'package.json'))).toBeNull();
    expect(reader.now('../escape.json')).toBeNull();
  });

  it('rethrows an unexpected git failure', () => {
    const repo = temp();
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'package.json'), '{}');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    const reader = gitManifestReader(repo);
    writeFileSync(join(repo, '.git', 'HEAD'), 'garbage\n');
    expect(() => reader.atHead('package.json')).toThrow();
  });

  it('returns null for a symlink inside the repo that points outside it', () => {
    const repo = temp();
    const outside = temp();
    git(repo, 'init', '-q');
    writeFileSync(join(outside, 'package.json'), '{"secret":1}');
    symlinkSync(join(outside, 'package.json'), join(repo, 'package.json'));
    symlinkSync(outside, join(repo, 'linkdir'));
    const reader = gitManifestReader(repo);
    expect(reader.now('package.json')).toBeNull();
    expect(reader.atHead('package.json')).toBeNull();
    expect(reader.now('linkdir/package.json')).toBeNull();
  });

  it('throws at construction outside a git repo', () => {
    expect(() => gitManifestReader(temp())).toThrow(/not inside a git repository/);
  });
});
