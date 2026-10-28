import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadGoldenExtras } from '../../../packages/core/fixture';
import { goldenFile, localGoldenReplay } from '../../../packages/core/server';
import { clock, compileReplay, lineLayout } from './compile';
import { buildReplayView } from './view';

async function golden() {
  const view = buildReplayView(await localGoldenReplay(), await readFile(goldenFile('git-diffs.patch'), 'utf8'), await loadGoldenExtras());
  // The page compiles the JSON the API sends, so compile a JSON round trip.
  const sent = JSON.parse(JSON.stringify(view)) as typeof view;
  return { view: sent, compiled: compileReplay(sent) };
}

function item(compiled: ReturnType<typeof compileReplay>, key: string) {
  const found = compiled.summary.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing summary item ${key}`);
  return found;
}

describe('compiled golden replay', () => {
  it('counts the summary band from the events, each linked to the events it counts', async () => {
    const { view, compiled } = await golden();
    const ids = new Set(view.events.map((event) => event.id));
    expect(item(compiled, 'sessions').value).toBe('2');
    expect(item(compiled, 'prompts').value).toBe('2');
    expect(item(compiled, 'tool_calls').value).toBe('12');
    expect(item(compiled, 'edits').value).toBe('3');
    expect(item(compiled, 'files')).toMatchObject({ value: '1', note: 'src/client.js' });
    expect(item(compiled, 'tests').value).toBe('4');
    expect(item(compiled, 'failed').value).toBe('3');
    expect(item(compiled, 'passed').value).toBe('1');
    expect(item(compiled, 'rerun').value).toBe('passed');
    expect(item(compiled, 'first_fail_pass')).toMatchObject({ label: 'Recording time', value: '0:30 → 2:58', note: 'first failure to first pass, 2 min 27 s' });
    expect(item(compiled, 'assertions').value).toBe('2');
    expect(item(compiled, 'kept')).toMatchObject({ label: 'Edits not superseded', value: '2' });
    expect(item(compiled, 'superseded').value).toBe('1');
    expect(item(compiled, 'answered')).toMatchObject({ value: '3', href: '#questions' });
    expect(item(compiled, 'usage')).toMatchObject({ value: '11 requests', note: 'context only', href: '#usage' });
    for (const entry of compiled.summary) {
      if (entry.href) continue;
      expect(entry.event_ids.length).toBeGreaterThan(0);
      for (const id of entry.event_ids) expect(ids.has(id)).toBe(true);
    }
    expect(item(compiled, 'failed').event_ids).toHaveLength(3);
    expect(item(compiled, 'tool_calls').event_ids).toHaveLength(12);
    expect(item(compiled, 'first_fail_pass').event_ids).toEqual([compiled.first_failure, compiled.first_pass]);
  });

  it('keeps counts and times only: no percentages, ratios, or rating words', async () => {
    const { compiled } = await golden();
    const text = JSON.stringify(compiled.summary);
    expect(text).not.toMatch(/%|\bratio\b|\bscore\b|\brank\b|\bhire\b|\bbetter\b|\bworse\b|\befficien/i);
  });

  it('finds the first failure and the first pass by media offset', async () => {
    const { view, compiled } = await golden();
    const at = (id: string | null) => view.events.find((event) => event.id === id)?.media_offset_ms;
    expect(compiled.first_failure).toBe(view.claim.failure.id);
    expect(at(compiled.first_failure)).toBe(30446);
    expect(compiled.first_pass).toBe(view.claim.pass.id);
    expect(at(compiled.first_pass)).toBe(177918);
    expect(clock(30446)).toBe('0:30');
    expect(clock(177918)).toBe('2:58');
    expect(clock(null)).toBe('no footage');
  });

  it('lists every test run in order, with the separate re-run as its own row', async () => {
    const { view, compiled } = await golden();
    expect(compiled.tests.map((row) => [row.n, row.status, row.session, row.rerun])).toEqual([
      [1, 'failed', 1, false],
      [2, 'failed', 1, false],
      [3, 'failed', 2, false],
      [4, 'passed', 2, false],
      [null, 'passed', null, true],
    ]);
    expect(compiled.tests.map((row) => row.assertion)).toEqual([
      'wrong base URL: expected /api, received /v0',
      'expected Authorization header',
      'expected Authorization header',
      null,
      null,
    ]);
    expect(compiled.tests[0].edit_before).toBeNull();
    expect(compiled.tests[1].edit_before).toMatchObject({ file: 'src/client.js', session: 1 });
    expect(compiled.tests[3].edit_before).toMatchObject({ file: 'src/client.js', session: 2 });
    expect(compiled.tests[4].id).toBe(view.claim.rerun.id);
    expect(compiled.tests[4].offset_ms).toBeNull();
    expect(compiled.tests[4].edit_before).toEqual(compiled.tests[3].edit_before);
  });

  it('places activity points by media offset, colour and shape by type', async () => {
    const { compiled } = await golden();
    const kinds = (kind: string) => compiled.activity.filter((point) => point.kind === kind).length;
    expect(kinds('prompt')).toBe(2);
    expect(kinds('tool_call')).toBe(12);
    expect(kinds('edit')).toBe(3);
    expect(kinds('test_failed')).toBe(3);
    expect(kinds('test_passed')).toBe(1);
    expect(compiled.activity.every((point) => point.offset_ms >= 0 && point.offset_ms <= compiled.last_offset_ms)).toBe(true);
  });

  it('builds stations from the real events and edges', async () => {
    const { view, compiled } = await golden();
    expect(compiled.stations.map((station) => station.kind)).toEqual([
      'prompt', 'test_failed', 'edit', 'test_failed',
      'prompt', 'test_failed', 'edit', 'edit', 'test_passed',
      'rerun',
    ]);
    expect(compiled.stations.map((station) => station.session)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, null]);
    const superseded = compiled.stations.filter((station) => station.superseded);
    const supersedes = view.edges.filter((edge) => edge.rel === 'supersedes').map((edge) => edge.dst);
    expect(superseded.map((station) => station.id)).toEqual(supersedes);
    expect(superseded).toHaveLength(1);
    expect(superseded[0].session).toBe(2);
    const route = compiled.stations.filter((station) => station.route);
    expect(route[0].id).toBe(view.claim.failure.id);
    expect(route[route.length - 1].id).toBe(view.claim.pass.id);
    expect(compiled.stations[4].detail).toBe('same prompt again');
    const rerun = compiled.stations[compiled.stations.length - 1];
    expect(rerun).toMatchObject({ kind: 'rerun', route: false, rerun_of: view.claim.pass.id, offset_ms: null });
  });

  it('lays the line out at 0, 45, and 90 degrees with one transfer and a re-run branch', async () => {
    const { compiled } = await golden();
    const layout = lineLayout(compiled.stations);
    expect(layout.stations).toHaveLength(compiled.stations.length);
    expect(layout.transfers).toHaveLength(1);
    expect(layout.sessions.map((session) => session.label)).toEqual(['SESSION 1', 'SESSION 2']);
    for (const d of [layout.session_path, layout.route_path, layout.rerun_path]) {
      const points: [number, number][] = [];
      let x = 0;
      let y = 0;
      for (const [, op, a, b] of d.matchAll(/([MLH])([\d.]+)(?: ([\d.]+))?/g)) {
        if (op === 'H') x = Number(a);
        else {
          if (op === 'L') points.push([Number(a) - x, Number(b) - y]);
          x = Number(a);
          y = Number(b);
        }
      }
      for (const [dx, dy] of points) expect(Math.abs(dx)).toBe(Math.abs(dy));
    }
    const pass = layout.stations.find((station) => station.kind === 'test_passed')!;
    const rerun = layout.stations.find((station) => station.kind === 'rerun')!;
    expect(layout.rerun_path.startsWith(`M${pass.x} ${pass.y}`)).toBe(true);
    expect(rerun.y).toBeGreaterThan(pass.y);
  });

  it('stacks the narrow line top to bottom at 0, 45, and 90 degrees with no sideways run', async () => {
    const { compiled } = await golden();
    const layout = lineLayout(compiled.stations, { vertical: true });
    expect(layout.orientation).toBe('vertical');
    expect(layout.width).toBeLessThanOrEqual(358);
    const ys = layout.stations.map((station) => station.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(layout.stations.every((station) => station.x < layout.label_x)).toBe(true);
    expect(layout.session_path).not.toContain('H');
    for (const d of [layout.session_path, layout.route_path, layout.rerun_path]) {
      let x = 0;
      let y = 0;
      for (const [, op, a, b] of d.matchAll(/([MLV])([\d.]+)(?: ([\d.]+))?/g)) {
        if (op === 'V') y = Number(a);
        else {
          if (op === 'L') expect(Math.abs(Number(a) - x)).toBe(Math.abs(Number(b) - y));
          x = Number(a);
          y = Number(b);
        }
      }
    }
    expect(layout.transfers).toHaveLength(1);
    // Timecodes end at least 8 px before the widest selected ring (r 20, stroke 2.5).
    const nearest = Math.min(...layout.stations.filter((station) => station.kind !== 'rerun').map((station) => station.x - (station.kind === 'test_passed' ? 27 : 20) - 1.25));
    expect(nearest - layout.time_x).toBeGreaterThanOrEqual(8);
  });
});
