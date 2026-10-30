import { describe, expect, it } from 'vitest';
import type { Edge, Event } from '../../../packages/core/event';
import { listSources, loadJourney } from './sources';
import { takeId, takeLabels, takeMedia, takeStoreFromEnv, webTakeStore, type RecordingRow, type TakeRow, type TakeStore } from './takes';

const take = (over: Partial<TakeRow> = {}): TakeRow => ({
  id: 'fullstack-take-2', label: 'Full-stack take 2', adapter: 'claude_code_hook', capture_status: 'verified',
  authorship: 'human', authorship_note: null, scenario: null, session_ids: ['s1'], analysis_status: 'complete', analysis_version: 'v1',
  verification: 'rerun_passed', coverage: { unknowns: [], not_captured: [] }, recorded_at: '2026-10-28T10:00:00Z', ingested_at: '2026-10-29T10:00:00Z', ...over,
});
const recording = (over: Partial<RecordingRow> = {}): RecordingRow => ({
  id: 'rec-1', take_id: 'fullstack-take-2', object_path: 'takes/fullstack-take-2/abcdef123456.mp4', content_type: 'video/mp4', duration_ms: 60000, mode: 'desktop',
  sync: { basis: 'media_recorder', uncertainty_ms: 0, anchors: [] }, redaction: { spans: 48, verified: { matches: 0 } }, ...over,
});
const event = (n: number, offset: number | null): Event => ({
  id: `s1:e${n}`, session_id: 's1', project_id: 'p', ts: `2026-10-28T10:00:0${n}Z`, seq: n, actor: n === 1 ? 'developer' : 'agent', type: n === 1 ? 'prompt' : 'tool_call',
  source: 'claude_code_hook', provenance: 'observed', recording_ref: null, media_offset_ms: offset, payload: n === 1 ? { text: 'Fix the bug', raw: { secret: 'x' } } : { tool_name: 'Bash', file: '/Users/someone/app.ts' },
});
const edge: Edge = { id: 'ed1', src: 's1:e1', dst: 's1:e2', rel: 'prompted', derived_by: 'rule', provenance: 'inferred', evidence_event_ids: ['s1:e1', 's1:e2'] };

type Fake = { takes?: TakeRow[]; events?: Event[]; edges?: Edge[]; recording?: RecordingRow | null; fail?: boolean; signed?: string[] };
function fakeStore(f: Fake = {}): TakeStore & { signed: string[] } {
  const takes = f.takes ?? [take()];
  const signed = f.signed ?? [];
  const guard = () => { if (f.fail) throw new Error('down'); };
  return {
    signed,
    async listVisible() { guard(); return takes; },
    async getVisible(id) { guard(); return takes.find((row) => row.id === id) ?? null; },
    async events() { guard(); return f.events ?? [event(1, 1000), event(2, 2000)]; },
    async edges() { guard(); return f.edges ?? [edge]; },
    async recording() { guard(); return f.recording === undefined ? recording() : f.recording; },
    async signedUrl(path) { signed.push(path); return `https://signed.example/${path}?token=t`; },
  };
}

describe('take sources', () => {
  it('lists only the takes the store returns as visible, after golden', async () => {
    const rows = await listSources(null, fakeStore({ takes: [take(), take({ id: 't3-take-3', label: 'T3 take', adapter: 't3_code', capture_status: 'experimental' })] }));
    expect(rows[0].key).toBe('golden');
    expect(rows.find((r) => r.key === 'take:fullstack-take-2')).toEqual({ key: 'take:fullstack-take-2', label: 'Full-stack take 2', status: 'verified', adapter: 'claude_code_hook' });
    expect(rows.find((r) => r.key === 'take:t3-take-3')).toMatchObject({ status: 'experimental', adapter: 't3_code' });
    expect((await listSources(null, fakeStore({ takes: [] }))).some((r) => r.key.startsWith('take:'))).toBe(false);
  });

  it('a list failure keeps the other sources', async () => {
    const rows = await listSources(null, fakeStore({ fail: true }));
    expect(rows.map((r) => r.key)).toEqual(['golden', ...rows.slice(1).map((r) => r.key)]);
    expect(rows.some((r) => r.key.startsWith('take:'))).toBe(false);
    expect(rows[0].key).toBe('golden');
  });

  it('loads a visible take with events, edges, media, and meta; strips raw payloads and home paths', async () => {
    const body = await loadJourney('take:fullstack-take-2', null, fakeStore());
    const source = body!.journey.source;
    expect(source).toMatchObject({ key: 'take:fullstack-take-2', status: 'verified', adapter: 'claude_code_hook' });
    expect(source.media?.url).toBe('/api/journey/media?source=take%3Afullstack-take-2');
    expect(source.take).toEqual({ authorship: 'human', authorship_note: null, analysis_status: 'complete', verification: 'rerun_passed', sync: { basis: 'media_recorder', uncertainty_ms: 0, anchors: 0 }, redaction: { spans: 48, matches: 0 } });
    expect(body!.edges).toEqual([edge]);
    expect(body!.events[0].payload.raw).toBeUndefined();
    expect(JSON.stringify(body!.events)).not.toContain('/Users/someone');
  });

  it('has no media and null sync/redaction without a recording row', async () => {
    const body = await loadJourney('take:fullstack-take-2', null, fakeStore({ recording: null }));
    expect(body!.journey.source.media).toBeNull();
    expect(body!.journey.source.take).toMatchObject({ sync: null, redaction: null });
  });

  it('returns null for a hidden or missing take, a bad key, or no store', async () => {
    expect(await loadJourney('take:other-take', null, fakeStore())).toBeNull();
    for (const key of ['take:', 'take:..', 'take:a/b', 'take:ab', 'take:Upper', 'take:-abc', 'take:%2e%2e']) expect(await loadJourney(key, null, fakeStore()), key).toBeNull();
    expect(await loadJourney('take:fullstack-take-2', null, null)).toBeNull();
  });

  it('a take with zero events still loads, and says analysis is not available', async () => {
    const body = await loadJourney('take:fullstack-take-2', null, fakeStore({ events: [], edges: [] }));
    expect(body!.events).toEqual([]);
    expect(takeLabels(body!.journey.source, body!.events)).toContain('Analysis not available for this recording.');
  });
});

describe('take labels', () => {
  const labels = async (t: Partial<TakeRow>, r: Partial<RecordingRow> | null, events: Event[] = [event(1, 1000), event(2, 2000)]) => {
    const body = await loadJourney('take:fullstack-take-2', null, fakeStore({ takes: [take(t)], recording: r === null ? null : recording(r), events }));
    return takeLabels(body!.journey.source, body!.events);
  };

  it('media_recorder: exact seek, with the blur line', async () => {
    const lines = await labels({}, {});
    expect(lines).toContain('Seek: exact (browser recording clock)');
    expect(lines).toContain('Personal details blurred in the video (48 areas, checked by OCR).');
    expect(lines.some((l) => l.startsWith('Scripted'))).toBe(false);
    expect(lines).not.toContain('Independent re-run: not run for this take.');
  });

  it('recorder_clock_calibrated: names the uncertainty and the anchor count', async () => {
    const sync = { basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: [{}, {}] };
    expect(await labels({}, { sync })).toContain('Seek: ±0.4 s (checked against 2 on-screen moments)');
  });

  it('uncalibrated basis, or a calibrated one with no offsets, turns seek off', async () => {
    const off = 'Seek is off for this recording: its clock was not checked.';
    expect(await labels({}, { sync: { basis: 'recorder_timeline_uncalibrated', uncertainty_ms: null } }, [event(1, null), event(2, null)])).toContain(off);
    expect(await labels({}, { sync: { basis: 'recorder_timeline_uncalibrated', uncertainty_ms: null } })).toContain(off);
    expect(await labels({}, { sync: { basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: [{}, {}] } }, [event(1, null), event(2, null)])).toContain(off);
    expect(await labels({}, { sync: { basis: 'media_recorder', uncertainty_ms: 0 } }, [event(1, null)])).toContain(off);
    // Ingest writes offsets only with 2+ anchors; if a row breaks that rule, never claim a check that did not happen.
    expect(await labels({}, { sync: { basis: 'recorder_clock_calibrated', uncertainty_ms: 400, anchors: [{}] } })).toContain(off);
  });

  it('orders sources by time across Postgres (+00:00, offsets) and capture (Z) formats', async () => {
    const takes = [
      take({ id: 'older-take', label: 'older', recorded_at: '2026-10-29T10:00:00+05:30' }), // 04:30 UTC
      take({ id: 'newer-take', label: 'newer', recorded_at: '2026-10-29T10:00:00.5+00:00' }),
    ];
    const keys = (await listSources(null, fakeStore({ takes }))).map((r) => r.key).filter((k) => k.startsWith('take:'));
    expect(keys).toEqual(['take:newer-take', 'take:older-take']);
    const pg = (n: number, ts: string): Event => ({ ...event(n, n * 1000), ts });
    const body = await loadJourney('take:fullstack-take-2', null, fakeStore({ events: [pg(2, '2026-10-28T10:00:02+00:00'), pg(1, '2026-10-28T10:00:01.5Z')] }));
    const stamps = body!.journey.stations.map((s) => Date.parse(s.ts));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it('no recording gives no seek or blur line', async () => {
    const lines = await labels({}, null);
    expect(lines.some((l) => l.startsWith('Seek') || l.startsWith('Personal details'))).toBe(false);
  });

  it('scripted authorship carries its note; verification none says no re-run', async () => {
    const lines = await labels({ authorship: 'scripted', authorship_note: 'Prompts typed by a script.', verification: 'none' }, {});
    expect(lines).toContain('Scripted demo: the prompts and answers were typed by a script, not a developer. Prompts typed by a script.');
    expect(lines).toContain('Independent re-run: not run for this take.');
  });

  it('partial evidence lists the unknowns and invents nothing; rerun_failed adds no label', async () => {
    expect(await labels({ analysis_status: 'partial', coverage: { unknowns: ['no test run seen', 'no model name'] } }, {})).toContain('Partial evidence: no test run seen; no model name');
    expect(await labels({ analysis_status: 'partial' }, {})).toContain('Partial evidence.');
    expect((await labels({ verification: 'rerun_failed' }, {})).some((l) => l.startsWith('Independent re-run'))).toBe(false);
  });

  it('reports leftover OCR matches instead of hiding them', async () => {
    expect(await labels({}, { redaction: { spans: 5, verified: { matches: 2 } } })).toContain('The OCR check still found 2 possible matches in the video.');
  });
});

describe('take media route logic', () => {
  it('302 to a 900 s signed URL for the recording row path, never cached', async () => {
    const store = fakeStore();
    const res = await takeMedia('take:fullstack-take-2', store);
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Location')).toBe('https://signed.example/takes/fullstack-take-2/abcdef123456.mp4?token=t');
    expect(store.signed).toEqual(['takes/fullstack-take-2/abcdef123456.mp4']);
  });

  it('asks for exactly 900 seconds', async () => {
    const seen: number[] = [];
    const store = { ...fakeStore(), async signedUrl(_p: string, s: number) { seen.push(s); return 'https://x.example/u'; } };
    await takeMedia('take:fullstack-take-2', store);
    expect(seen).toEqual([900]);
  });

  it('404 for a hidden take, a missing recording, a bad key, no store, or a failing store', async () => {
    const cases: [string, TakeStore | null][] = [
      ['take:other-take', fakeStore()],
      ['take:fullstack-take-2', fakeStore({ recording: null })],
      ['take:../x', fakeStore()],
      ['take:a/b', fakeStore()],
      ['take:fullstack-take-2', null],
      ['take:fullstack-take-2', fakeStore({ fail: true })],
    ];
    for (const [key, store] of cases) {
      const res = await takeMedia(key, store);
      expect(res.status, key).toBe(404);
      expect(await res.text()).toBe('Recording unavailable.');
    }
  });

  it('never signs a path from the request', async () => {
    const store = fakeStore();
    await takeMedia('take:fullstack-take-2', store);
    await takeMedia('take:other-take', store);
    expect(store.signed).toEqual(['takes/fullstack-take-2/abcdef123456.mp4']);
  });
});

describe('take store env rule', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://hivfaqlabtbrhrviwrrm.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
  it('is null when the variables are missing or name another project or scheme', () => {
    expect(takeStoreFromEnv({})).toBeNull();
    expect(takeStoreFromEnv({ ...env, SUPABASE_SECRET_KEY: undefined })).toBeNull();
    expect(takeStoreFromEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' })).toBeNull();
    expect(takeStoreFromEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://hivfaqlabtbrhrviwrrm.supabase.co' })).toBeNull();
    expect(takeStoreFromEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'not a url' })).toBeNull();
  });
  it('a local DEVLENS_OFFLINE=1 run reads no takes; Vercel still does', () => {
    expect(webTakeStore({ ...env, DEVLENS_OFFLINE: '1' })).toBeNull();
    expect(webTakeStore({ ...env, DEVLENS_OFFLINE: '1', VERCEL: '1' })).not.toBeNull();
    expect(webTakeStore(env)).not.toBeNull();
  });
  it('takeId accepts only the id pattern', () => {
    expect(takeId('take:golden-broken-api')).toBe('golden-broken-api');
    expect(takeId('t3-pub:abc')).toBeNull();
  });
});
