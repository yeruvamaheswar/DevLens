import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkEvents } from '../../link/src/rules';
import {
  IngestError, ingestTake, parseIngestArgs, planTake, runIngest, scrubString, scrubValue, seekDecision, uploadPlayback,
  type Counts, type LiveDeps, type Probe, type RecordingStore, type SyncSpec, type TakeSpec,
} from '../src/ingest';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ingest');
const PLAYBACK = Buffer.from('fake playback bytes for the ingest tests');
const SOURCE = Buffer.from('fake original recording bytes');
const SOURCE_SHA = createHash('sha256').update(SOURCE).digest('hex');
const PLAYBACK_SHA = createHash('sha256').update(PLAYBACK).digest('hex');
// Fixture events start at 15:00:01; the fake video starts 1 s earlier and lasts 10 s.
const WALL_START = Date.parse('2026-10-26T15:00:00.000Z');
const probe: Probe = async () => ({ video_codec: 'h264', audio_streams: 0, duration_ms: 10000, width: 1920, height: 1080 });

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'devlens-ingest-'));
  home = path.join(root, 'home', 'someone');
  cpSync(FIXTURES, path.join(root, 'fx'), { recursive: true });
  writeFileSync(path.join(root, 'playback.mp4'), PLAYBACK);
  writeFileSync(path.join(root, 'source.mp4'), SOURCE);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function sync(partial: Partial<SyncSpec> = {}): SyncSpec {
  return { basis: 'media_recorder', wall_start_ms: WALL_START, uncertainty_ms: 0, anchors: [], ...partial };
}

function claudeTake(partial: Partial<TakeSpec> = {}): TakeSpec {
  return {
    id: 'fixture-claude', label: 'Fixture', adapter: 'claude_code_hook', capture_status: 'verified',
    authorship: 'human', authorship_note: null, scenario: null, session_ids: ['ses-a'],
    events: ['fx/claude/events.jsonl'], edges: null, rerun: 'fx/claude/rerun.jsonl',
    coverage: { unknowns: [], not_captured: [] }, verification: 'rerun_passed', expected: { events: 4 },
    recording: {
      id: 'fixture-claude-playback', playback: 'playback.mp4', source: 'source.mp4', source_sha256: SOURCE_SHA,
      mode: 'window', consent: true, sync: sync(),
      redaction: { method: 'test', spans: 2, verified: { fps: 6, offset_s: 0.05, pattern: 'x', matches: 0 }, residual_note: null },
    },
    content_reviewed_at: null,
    ...partial,
  };
}

function t3Take(partial: Partial<TakeSpec> = {}): TakeSpec {
  return {
    ...claudeTake(), id: 'fixture-t3', adapter: 't3_code', capture_status: 'experimental', session_ids: ['t3:th'],
    events: ['fx/t3/events.jsonl'], edges: 'fx/t3/edges.jsonl', rerun: 'fx/t3/rerun.jsonl', expected: { events: 3 },
    recording: null, ...partial,
  };
}

const plan = (spec: TakeSpec, secrets: string[] = []) => planTake(spec, { root, home, probe, secrets });

type Calls = { uploads: string[]; rpc: number; visible: string[] };

function fakes(options: { existing?: Map<string, number>; range?: number; counts?: Partial<Counts> } = {}): { deps: LiveDeps; calls: Calls } {
  const objects = options.existing ?? new Map<string, number>();
  const calls: Calls = { uploads: [], rpc: 0, visible: [] };
  let last: Counts = { events: 0, edges: 0, recordings: 0 };
  const store: RecordingStore = {
    async upload(object, body) {
      if (objects.has(object)) return 'exists';
      objects.set(object, body.length);
      calls.uploads.push(object);
      return 'created';
    },
    async size(object) { return objects.get(object) ?? null; },
    async signedUrl(object) { return objects.has(object) ? `https://fake/${object}` : null; },
  };
  const deps: LiveDeps = {
    store,
    db: {
      async replaceTake(args) {
        calls.rpc++;
        last = { events: (args.p_events as unknown[]).length, edges: (args.p_edges as unknown[]).length, recordings: args.p_recording ? 1 : 0 };
        return last;
      },
      async counts() { return { ...last, ...options.counts }; },
      async setVisible(id) { calls.visible.push(id); },
    },
    range: async () => options.range ?? 206,
  };
  return { deps, calls };
}

describe('plan', () => {
  it('counts events, edges, and offsets for a Claude Code take; rerun events keep null media', async () => {
    const result = await plan(claudeTake());
    expect(result.events).toHaveLength(5);
    const sessionEvents = result.events.filter((event) => event.source === 'claude_code_hook');
    // 3 prompted, 1 edited, 1 ran_test, 1 verifies (the linker over 4 session events + 1 rerun).
    expect(result.edges).toHaveLength(6);
    expect(result.edges).toHaveLength(linkEvents(result.events as never).length);
    expect(result.offsets).toBe(4);
    expect(sessionEvents.map((event) => event.media_offset_ms)).toEqual([1000, 3000, 5000, 7000]);
    expect(new Set(sessionEvents.map((event) => event.recording_ref))).toEqual(new Set([`takes/fixture-claude/${PLAYBACK_SHA.slice(0, 12)}.mp4`]));
    const rerun = result.events.find((event) => event.source === 'sandbox');
    expect(rerun).toMatchObject({ recording_ref: null, media_offset_ms: null });
    expect(result.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(result.recording).toMatchObject({ bytes: PLAYBACK.length, sha256: PLAYBACK_SHA, source_sha256: SOURCE_SHA, source_bytes: SOURCE.length, duration_ms: 10000, content_type: 'video/mp4', audio_tracks: 0 });
    expect(result.take).toMatchObject({ analysis_status: 'complete', verification: 'rerun_passed', recorded_at: '2026-10-26T15:00:01.000Z' });
    expect(result.blockers).toEqual([]);
  });

  it('keeps T3 events and edges as captured, merges the rerun copy, and clears old media fields without a recording', async () => {
    const result = await plan(t3Take());
    expect(result.events).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(result.offsets).toBe(0);
    expect(result.events.every((event) => event.recording_ref === null && event.media_offset_ms === null)).toBe(true);
  });

  it('refuses when the event count differs from expected.events', async () => {
    await expect(plan(claudeTake({ expected: { events: 5 } }))).rejects.toThrow(/expected 5 events, read 4/);
  });

  it('reports a missing playback file as a blocker and still plans events and edges', async () => {
    rmSync(path.join(root, 'playback.mp4'));
    const result = await plan(claudeTake());
    expect(result.blockers).toContain('playback missing');
    expect(result.events).toHaveLength(5);
    expect(result.offsets).toBe(0);
    expect(result.recording).toBeNull();
  });

  it('refuses when the source hash does not match source_sha256', async () => {
    writeFileSync(path.join(root, 'source.mp4'), 'changed');
    await expect(plan(claudeTake())).rejects.toThrow(/does not match source_sha256/);
  });

  it('refuses a playback file with an audio stream', async () => {
    const withAudio: Probe = async () => ({ video_codec: 'h264', audio_streams: 1, duration_ms: 10000, width: null, height: null });
    await expect(planTake(claudeTake(), { root, home, probe: withAudio, secrets: [] })).rejects.toThrow(/audio stream/);
  });
});

describe('seek rule', () => {
  const anchors = (deltas: number[]) => deltas.map((d, i) => ({ event_id: i === 0 ? 'ses-a:toolu_1:post' : 'ses-a:toolu_3:post', expected_video_s: 3 + i * 4, observed_video_s: 3 + i * 4 + d }));

  it('calibrated with 2 anchors inside the uncertainty: offsets are written', async () => {
    const spec = claudeTake();
    spec.recording!.sync = sync({ basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: anchors([-0.1, 0.1]) });
    expect(seekDecision(spec.recording!.sync).enabled).toBe(true);
    expect((await plan(spec)).offsets).toBe(4);
  });

  it('calibrated with an anchor outside the uncertainty: offsets are null', async () => {
    const spec = claudeTake();
    spec.recording!.sync = sync({ basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: anchors([0.1, 0.5]) });
    const result = await plan(spec);
    expect(result.seek.enabled).toBe(false);
    expect(result.offsets).toBe(0);
    expect(result.events.every((event) => event.recording_ref === null)).toBe(true);
    expect(result.recording).not.toBeNull();
  });

  it('calibrated with fewer than 2 anchors: offsets are null', async () => {
    const spec = claudeTake();
    spec.recording!.sync = sync({ basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: anchors([0]) });
    expect((await plan(spec)).offsets).toBe(0);
  });

  it('uncalibrated: offsets are always null', async () => {
    const spec = t3Take({ recording: { ...claudeTake().recording!, sync: { basis: 'recorder_timeline_uncalibrated', wall_start_ms: null, uncertainty_ms: null, anchors: [] } } });
    const result = await plan(spec);
    expect(result.seek.enabled).toBe(false);
    expect(result.offsets).toBe(0);
    expect(result.recording).not.toBeNull();
  });

  it('refuses an anchor that names no event of the take', async () => {
    const spec = claudeTake();
    spec.recording!.sync = sync({ basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: [{ event_id: 'nope', expected_video_s: 1, observed_video_s: 1 }, ...anchors([0])] });
    await expect(plan(spec)).rejects.toThrow(/anchor nope/);
  });
});

describe('scrub and secrets', () => {
  it('replaces the home directory and any /Users/<name> prefix with ~', () => {
    expect(scrubString('/home/me/repo and /Users/other/x', '/home/me')).toBe('~/repo and ~/x');
    expect(scrubValue({ a: ['/Users/a/b'], '/Users/k/v': 1 }, '/nowhere')).toEqual({ a: ['~/b'], '~/v': 1 });
  });

  it('scrubs every string in the planned payload', async () => {
    const result = await plan(claudeTake());
    expect(JSON.stringify(result.events)).not.toContain('/Users/');
    expect(JSON.stringify(result.events)).toContain('~/work/app');
  });

  it('refuses a payload that contains sb_secret_', async () => {
    const file = path.join(root, 'fx', 'claude', 'events.jsonl');
    const { readFileSync } = await import('node:fs');
    writeFileSync(file, readFileSync(file, 'utf8').replace('run npm test', 'use sb_secret_abcdefgh123'));
    await expect(plan(claudeTake())).rejects.toThrow(/secret value/);
  });

  it('refuses a payload that contains an env secret value', async () => {
    await expect(plan(claudeTake(), ['wrong base URL'])).rejects.toThrow(/secret value/);
  });
});

describe('refusals', () => {
  it('refuses an event whose session is not listed', async () => {
    await expect(plan(claudeTake({ session_ids: ['other'] }))).rejects.toThrow(/session the take does not list/);
  });

  it('refuses an edge whose src or dst is not an event of the take', async () => {
    writeFileSync(path.join(root, 'fx', 't3', 'edges.jsonl'), JSON.stringify({ id: 'e1', src: 't3:th:m1', dst: 'missing', rel: 'prompted', derived_by: 'r', provenance: 'inferred', evidence_event_ids: [] }) + '\n');
    await expect(plan(t3Take())).rejects.toThrow(/edge e1 names an event/);
  });

  it('refuses a rerun copy that differs from the captured event in more than seq', async () => {
    const file = path.join(root, 'fx', 't3', 'rerun.jsonl');
    const { readFileSync } = await import('node:fs');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"output":"ok"', '"output":"changed"'));
    await expect(plan(t3Take())).rejects.toThrow(/appears twice with different content/);
  });
});

describe('upload and publish', () => {
  it('uploads once, then skips an existing object of the same size', async () => {
    const result = await plan(claudeTake());
    const existing = new Map<string, number>();
    const first = fakes({ existing });
    expect(await uploadPlayback(first.deps.store, result.playback!)).toBe('uploaded');
    expect(await uploadPlayback(first.deps.store, result.playback!)).toBe('skipped');
    expect(first.calls.uploads).toEqual([result.playback!.object_path]);
  });

  it('stops when the existing object has a different size', async () => {
    const result = await plan(claudeTake());
    const { deps } = fakes({ existing: new Map([[result.playback!.object_path, PLAYBACK.length + 1]]) });
    await expect(uploadPlayback(deps.store, result.playback!)).rejects.toThrow(/different size/);
  });

  it('runs every check and leaves the take hidden without --publish', async () => {
    const result = await plan(claudeTake());
    const { deps, calls } = fakes();
    const checks = await ingestTake(result, deps, { publish: false, log: () => {} });
    expect(checks.map((check) => check.pass)).toEqual([true, true, true, true]);
    expect(calls.rpc).toBe(1);
    expect(calls.visible).toEqual([]);
  });

  it('refuses --publish without content_reviewed_at before any upload or rpc', async () => {
    const result = await plan(claudeTake());
    const { deps, calls } = fakes();
    await expect(ingestTake(result, deps, { publish: true, log: () => {} })).rejects.toThrow(/content_reviewed_at is not set/);
    expect(calls.uploads).toEqual([]);
    expect(calls.rpc).toBe(0);
  });

  it('does not publish when a check fails', async () => {
    const result = await plan(claudeTake({ content_reviewed_at: '2026-10-30T10:00:00Z' }));
    const { deps, calls } = fakes({ range: 200 });
    await expect(ingestTake(result, deps, { publish: true, log: () => {} })).rejects.toThrow(/check failed/);
    expect(calls.visible).toEqual([]);
  });

  it('publishes after every check passes and content_reviewed_at is set', async () => {
    const result = await plan(claudeTake({ content_reviewed_at: '2026-10-30T10:00:00Z' }));
    const { deps, calls } = fakes();
    await ingestTake(result, deps, { publish: true, log: () => {} });
    expect(calls.visible).toEqual(['fixture-claude']);
  });

  it('refuses to go live while a blocker remains', async () => {
    rmSync(path.join(root, 'playback.mp4'));
    const result = await plan(claudeTake());
    const { deps, calls } = fakes();
    await expect(ingestTake(result, deps, { publish: false, log: () => {} })).rejects.toThrow(/playback missing/);
    expect(calls.rpc).toBe(0);
  });
});

describe('cli', () => {
  it('parses the three forms and rejects the rest', () => {
    expect(parseIngestArgs(['--dry-run', '--all'])).toMatchObject({ dryRun: true, all: true });
    expect(parseIngestArgs(['--take', 'x-1', '--publish'])).toMatchObject({ take: 'x-1', publish: true });
    expect(() => parseIngestArgs(['--all'])).toThrow(IngestError);
    expect(() => parseIngestArgs(['--dry-run'])).toThrow(IngestError);
    expect(() => parseIngestArgs(['--dry-run', '--take', 'x-1', '--publish'])).toThrow(IngestError);
  });

  it('dry-run reports a bad take and keeps going', async () => {
    const manifest = path.join(root, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ takes: [claudeTake({ expected: { events: 9 } }), t3Take()] }));
    const lines: string[] = [];
    const result = await runIngest({ dryRun: true, all: true, publish: false }, { manifest, root, home, probe, secrets: [], log: (line) => lines.push(line) });
    expect(result.failed).toEqual(['fixture-claude']);
    expect(result.plans.map((p) => p.id)).toEqual(['fixture-t3']);
    expect(lines.join('\n')).toMatch(/ERROR: fixture-claude: expected 9 events/);
  });

  it('a live run loads server env before the secret check, so a value only in .env is refused (review A, finding 1)', async () => {
    const manifest = path.join(root, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ takes: [claudeTake()] }));
    const { deps, calls } = fakes();
    const name = 'DEVLENS_TEST_ONLY_SECRET_KEY';
    // Stands in for process.loadEnvFile: the value appears in process.env only when the live loader runs.
    const loadEnv = () => { process.env[name] = 'Fix the test in'; return { url: 'https://hivfaqlabtbrhrviwrrm.supabase.co', secret: 'unused' }; };
    try {
      await expect(runIngest({ dryRun: false, all: false, take: 'fixture-claude', publish: false }, { manifest, root, home, probe, deps, loadEnv, log: () => {} })).rejects.toThrow(/secret value/);
      expect(calls.rpc).toBe(0);
    } finally {
      delete process.env[name];
    }
  });

  it('refuses an absolute manifest path', async () => {
    await expect(plan(claudeTake({ events: [path.join(root, 'fx', 'claude', 'events.jsonl')] }))).rejects.toThrow(/must start with ~\//);
  });
});
