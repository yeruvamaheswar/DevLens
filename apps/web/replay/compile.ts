// Pure compilation of a replay view into the summary band, the line diagram,
// the activity strip, and the test history. Counts and times only. No I/O.
import type { Edge, Event } from '../../../packages/core/event';
import type { ReplayView } from './view';

export type StationKind = 'prompt' | 'test_failed' | 'test_passed' | 'test_unknown' | 'edit' | 'rerun';

export type Station = {
  id: string;
  kind: StationKind;
  session: number | null; // 1-based session number; null for the separate re-run
  offset_ms: number | null;
  title: string;
  detail: string;
  superseded: boolean;
  route: boolean; // on the first-failure to pass route
  rerun_of: string | null;
};

export type SummaryItem = {
  key: string;
  label: string;
  value: string;
  note: string | null;
  event_ids: string[];
  href: string | null;
};

export type TestRow = {
  id: string;
  n: number | null; // order among session test runs; null for the re-run
  status: 'passed' | 'failed' | 'unknown';
  assertion: string | null;
  offset_ms: number | null;
  session: number | null;
  edit_before: { id: string; file: string | null; session: number | null } | null;
  rerun: boolean;
};

export type ActivityKind = 'prompt' | 'tool_call' | 'edit' | 'test_failed' | 'test_passed';
export type ActivityPoint = { id: string; kind: ActivityKind; offset_ms: number };

export type CompiledReplay = {
  stations: Station[];
  summary: SummaryItem[];
  tests: TestRow[];
  activity: ActivityPoint[];
  last_offset_ms: number;
  first_failure: string | null;
  first_pass: string | null;
};

type ViewInput = Pick<ReplayView, 'events' | 'edges' | 'questions' | 'usage'>;

export function clock(ms: number | null): string {
  if (ms == null) return 'no footage';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function span(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function statusOf(event: Event): 'passed' | 'failed' | 'unknown' | null {
  const status = event.payload.status;
  return status === 'passed' || status === 'failed' || status === 'unknown' ? status : null;
}

function offsetOf(event: Event): number | null {
  const value = event.media_offset_ms as number | string | null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function assertionOf(event: Event): string | null {
  return text(event.payload.output).match(/AssertionError \[ERR_ASSERTION\]: (.+)/)?.[1]?.trim() || null;
}

function isRerun(event: Event): boolean {
  return event.source === 'sandbox';
}

function isSessionTest(event: Event): boolean {
  return event.type === 'test' && !isRerun(event) && statusOf(event) != null;
}

function isEdit(event: Event): boolean {
  return event.type === 'file_edit' && !isRerun(event);
}

export function fileOf(event: Event): string | null {
  const files = event.payload.files;
  return Array.isArray(files) && files.length > 0 ? String(files[0]) : null;
}

function toolUseOf(event: Event): string | null {
  if (event.tool_use_id) return event.tool_use_id;
  const part = event.id.split(':')[1];
  return part?.startsWith('toolu_') ? part : null;
}

function shorten(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trim()}…`;
}

function passDetail(event: Event): string {
  const output = text(event.payload.output);
  const pass = output.match(/(?:ℹ|#)\s*pass (\d+)/)?.[1];
  const fail = output.match(/(?:ℹ|#)\s*fail (\d+)/)?.[1];
  if (pass != null && fail != null) return `pass ${pass}, fail ${fail}`;
  return 'reported a pass';
}

function sessionNumbers(events: readonly Event[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const event of events) {
    if (isRerun(event) || numbers.has(event.session_id)) continue;
    numbers.set(event.session_id, numbers.size + 1);
  }
  return numbers;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function compileReplay(view: ViewInput): CompiledReplay {
  const events = view.events;
  const edges: readonly Edge[] = view.edges;
  const sessions = sessionNumbers(events);
  const sessionOf = (event: Event) => (isRerun(event) ? null : sessions.get(event.session_id) ?? null);

  const prompts = events.filter((event) => event.type === 'prompt' && !isRerun(event));
  const edits = events.filter(isEdit);
  const tests = events.filter(isSessionTest);
  const failed = tests.filter((event) => statusOf(event) === 'failed');
  const passed = tests.filter((event) => statusOf(event) === 'passed');
  const reruns = events.filter((event) => isRerun(event) && event.type === 'test');
  const supersededIds = new Set(edges.filter((edge) => edge.rel === 'supersedes').map((edge) => edge.dst));

  const firstFailure = failed[0] ?? null;
  const firstPass = firstFailure ? passed.find((event) => events.indexOf(event) > events.indexOf(firstFailure)) ?? null : passed[0] ?? null;
  const lastPass = passed[passed.length - 1] ?? null;

  // Tool calls: one per tool use id, counted from the first hooked event of that use.
  const toolFirst = new Map<string, Event>();
  for (const event of events) {
    if (isRerun(event)) continue;
    if (event.type !== 'tool_call' && event.type !== 'test' && event.type !== 'file_edit') continue;
    const use = toolUseOf(event);
    if (use && !toolFirst.has(use)) toolFirst.set(use, event);
  }
  const toolCalls = [...toolFirst.values()];

  const files = [...new Set(edits.map(fileOf).filter((file): file is string => file != null))];
  const assertions = [...new Set(failed.map(assertionOf).filter((line): line is string => line != null))];

  // Stations: prompts, session tests, and edits in take order; the re-run last.
  const routeStart = firstFailure ? events.indexOf(firstFailure) : -1;
  const routeEnd = lastPass ? events.indexOf(lastPass) : -1;
  const seenPrompts: string[] = [];
  const stations: Station[] = [];
  events.forEach((event, index) => {
    let kind: StationKind | null = null;
    if (event.type === 'prompt' && !isRerun(event)) kind = 'prompt';
    else if (isSessionTest(event)) kind = statusOf(event) === 'failed' ? 'test_failed' : statusOf(event) === 'passed' ? 'test_passed' : 'test_unknown';
    else if (isEdit(event)) kind = 'edit';
    if (!kind) return;
    let detail = '';
    if (kind === 'prompt') {
      const prompt = text(event.payload.prompt);
      detail = seenPrompts.includes(prompt) ? 'same prompt again' : shorten(prompt, 26);
      seenPrompts.push(prompt);
    } else if (kind === 'test_failed') detail = assertionOf(event) ?? 'no assertion line';
    else if (kind === 'test_passed') detail = passDetail(event);
    else if (kind === 'test_unknown') detail = 'status unknown';
    else detail = fileOf(event) ?? 'file unknown';
    stations.push({
      id: event.id,
      kind,
      session: sessionOf(event),
      offset_ms: offsetOf(event),
      title: kind === 'prompt' ? 'prompt' : kind === 'edit' ? 'edit' : kind === 'test_failed' ? 'test failed' : kind === 'test_passed' ? 'test passed' : 'test',
      detail,
      superseded: supersededIds.has(event.id),
      route: routeStart >= 0 && routeEnd >= routeStart && index >= routeStart && index <= routeEnd,
      rerun_of: null,
    });
  });
  for (const rerun of reruns) {
    stations.push({
      id: rerun.id,
      kind: 'rerun',
      session: null,
      offset_ms: null,
      title: 'separate re-run',
      detail: statusOf(rerun) ?? 'unknown',
      superseded: false,
      route: false,
      rerun_of: text(rerun.payload.rerun_of) || null,
    });
  }

  const firstOfSession = [...sessions.keys()].map((id) => events.find((event) => event.session_id === id && !isRerun(event))!.id);
  const answered = view.questions.filter((question) => question.answer != null).length;
  const rerun = reruns[0] ?? null;
  const summary: SummaryItem[] = [
    { key: 'sessions', label: 'Sessions', value: String(sessions.size), note: null, event_ids: firstOfSession, href: null },
    { key: 'prompts', label: 'Prompts', value: String(prompts.length), note: null, event_ids: prompts.map((event) => event.id), href: null },
    { key: 'tool_calls', label: 'Tool calls', value: String(toolCalls.length), note: null, event_ids: toolCalls.map((event) => event.id), href: null },
    { key: 'edits', label: 'Edits', value: String(edits.length), note: null, event_ids: edits.map((event) => event.id), href: null },
    { key: 'files', label: 'Files changed', value: String(files.length), note: files.join(', ') || null, event_ids: edits.map((event) => event.id), href: null },
    { key: 'tests', label: 'Session test runs', value: String(tests.length), note: null, event_ids: tests.map((event) => event.id), href: null },
    { key: 'failed', label: 'Failed', value: String(failed.length), note: null, event_ids: failed.map((event) => event.id), href: null },
    { key: 'passed', label: 'Passed', value: String(passed.length), note: null, event_ids: passed.map((event) => event.id), href: null },
    { key: 'rerun', label: 'Separate re-run', value: rerun ? statusOf(rerun) ?? 'unknown' : 'none', note: rerun ? 'a worker, not the session' : null, event_ids: rerun ? [rerun.id] : [], href: null },
    {
      key: 'first_fail_pass',
      label: 'Recording time',
      value: firstFailure && firstPass ? `${clock(offsetOf(firstFailure))} → ${clock(offsetOf(firstPass))}` : 'none',
      note: firstFailure && firstPass && offsetOf(firstFailure) != null && offsetOf(firstPass) != null ? `first failure to first pass, ${span(offsetOf(firstPass)! - offsetOf(firstFailure)!)}` : null,
      event_ids: [firstFailure, firstPass].filter((event): event is Event => event != null).map((event) => event.id),
      href: null,
    },
    { key: 'assertions', label: 'Distinct failing assertions', value: String(assertions.length), note: null, event_ids: failed.map((event) => event.id), href: null },
    { key: 'kept', label: 'Edits not superseded', value: String(edits.filter((event) => !supersededIds.has(event.id)).length), note: null, event_ids: edits.filter((event) => !supersededIds.has(event.id)).map((event) => event.id), href: null },
    { key: 'superseded', label: 'Superseded', value: String(edits.filter((event) => supersededIds.has(event.id)).length), note: 'kept on the line', event_ids: edits.filter((event) => supersededIds.has(event.id)).map((event) => event.id), href: null },
    { key: 'answered', label: 'Questions answered', value: String(answered), note: `${count(view.questions.length, 'question', 'questions')} asked`, event_ids: [], href: '#questions' },
    { key: 'usage', label: 'Coding-agent usage', value: view.usage ? count(view.usage.requests, 'request', 'requests') : 'not read', note: 'context only', event_ids: [], href: '#usage' },
  ];

  const testRows: TestRow[] = [];
  tests.forEach((event, index) => {
    const before = [...edits].reverse().find((edit) => events.indexOf(edit) < events.indexOf(event)) ?? null;
    testRows.push({
      id: event.id,
      n: index + 1,
      status: statusOf(event)!,
      assertion: statusOf(event) === 'failed' ? assertionOf(event) : null,
      offset_ms: offsetOf(event),
      session: sessionOf(event),
      edit_before: before ? { id: before.id, file: fileOf(before), session: sessionOf(before) } : null,
      rerun: false,
    });
  });
  for (const event of reruns) {
    const of = testRows.find((row) => row.id === text(event.payload.rerun_of));
    testRows.push({
      id: event.id,
      n: null,
      status: statusOf(event) ?? 'unknown',
      assertion: statusOf(event) === 'failed' ? assertionOf(event) : null,
      offset_ms: null,
      session: null,
      edit_before: of?.edit_before ?? null,
      rerun: true,
    });
  }

  const activity: ActivityPoint[] = [];
  const toolIds = new Set(toolCalls.map((event) => event.id));
  for (const event of events) {
    const offset = offsetOf(event);
    if (offset == null || isRerun(event)) continue;
    if (event.type === 'prompt') activity.push({ id: event.id, kind: 'prompt', offset_ms: offset });
    else if (isEdit(event)) activity.push({ id: event.id, kind: 'edit', offset_ms: offset });
    else if (isSessionTest(event)) activity.push({ id: event.id, kind: statusOf(event) === 'passed' ? 'test_passed' : 'test_failed', offset_ms: offset });
    if (toolIds.has(event.id) && event.type === 'tool_call') activity.push({ id: event.id, kind: 'tool_call', offset_ms: offset });
  }
  const offsets = events.map(offsetOf).filter((value): value is number => value != null);

  return {
    stations,
    summary,
    tests: testRows,
    activity,
    last_offset_ms: offsets.length > 0 ? Math.max(...offsets) : 0,
    first_failure: firstFailure?.id ?? null,
    first_pass: firstPass?.id ?? null,
  };
}

// ---- Line diagram geometry. Lines run at 0, 45, and 90 degrees only. ----

export type PlacedStation = Station & { x: number; y: number; lines: string[] };
export type LineLayout = {
  orientation: 'horizontal' | 'vertical';
  width: number;
  height: number;
  label_x: number; // vertical only: where station labels start
  time_x: number; // vertical only: right edge of the timecode column
  stations: PlacedStation[];
  session_path: string;
  route_path: string;
  rerun_path: string;
  transfers: { x: number; y: number }[];
  sessions: { label: string; x: number; y: number }[];
};

function wrap(value: string, width: number, max: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1]}…`;
    return kept;
  }
  return lines;
}

// Joins stations with straight runs and 45-degree transfers. `along` is the axis the line travels.
function pathThrough(list: readonly PlacedStation[], along: 'x' | 'y') {
  const transfers: { x: number; y: number }[] = [];
  if (list.length === 0) return { d: '', transfers };
  let d = `M${list[0].x} ${list[0].y}`;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (along === 'x') {
      if (a.y === b.y) d += `H${b.x}`;
      else {
        const dy = Math.abs(b.y - a.y);
        const flat = (b.x - a.x - dy) / 2;
        d += `H${a.x + flat}L${a.x + flat + dy} ${b.y}H${b.x}`;
        transfers.push({ x: a.x + flat + dy / 2, y: (a.y + b.y) / 2 });
      }
    } else if (a.x === b.x) d += `V${b.y}`;
    else {
      const dx = Math.abs(b.x - a.x);
      const flat = (b.y - a.y - dx) / 2;
      d += `V${a.y + flat}L${b.x} ${a.y + flat + dx}V${b.y}`;
      transfers.push({ x: (a.x + b.x) / 2, y: a.y + flat + dx / 2 });
    }
  }
  return { d, transfers };
}

function verticalLayout(stations: readonly Station[]): LineLayout {
  const step = 60;
  const shift = 30; // sideways offset of a transfer; the diagonal runs 45 degrees
  const timeX = 34; // keeps 8 px or more between a timecode and the selected-station ring
  const colX = 66;
  const top = 40;
  const main = stations.filter((station) => station.kind !== 'rerun');
  const reruns = stations.filter((station) => station.kind === 'rerun');
  const sessionList = [...new Set(main.map((station) => station.session ?? 0))];
  const levels = Math.max(sessionList.length - 1, 0) + (reruns.length > 0 ? 1 : 0);
  const labelX = colX + levels * shift + 30;

  const placed: PlacedStation[] = [];
  let y = top;
  main.forEach((station, index) => {
    const prev = main[index - 1];
    if (prev) y += prev.session === station.session ? step : step + shift + 22;
    const level = sessionList.indexOf(station.session ?? 0);
    placed.push({ ...station, x: colX + level * shift, y, lines: wrap(station.detail, 30, 2) });
  });
  const full = pathThrough(placed, 'y');
  const route = pathThrough(placed.filter((station) => station.route), 'y');

  let rerunPath = '';
  for (const rerun of reruns) {
    const from = placed.find((station) => station.id === rerun.rerun_of) ?? placed[placed.length - 1];
    if (!from) continue;
    const end = { x: from.x + shift, y: from.y + shift + 40 };
    rerunPath += `M${from.x} ${from.y}L${end.x} ${from.y + shift}V${end.y}`;
    placed.push({ ...rerun, x: end.x, y: end.y, lines: [`${rerun.detail}, a worker, not the session`, 'no footage'] });
  }

  const sessions = sessionList.map((session) => {
    const first = placed.find((station) => (station.session ?? 0) === session && station.kind !== 'rerun')!;
    return { label: `SESSION ${session}`, x: labelX, y: first.y - 24 };
  });
  return {
    orientation: 'vertical',
    width: 358,
    height: Math.max(...placed.map((station) => station.y)) + 40,
    label_x: labelX,
    time_x: timeX,
    stations: placed,
    session_path: full.d,
    route_path: route.d,
    rerun_path: rerunPath,
    transfers: full.transfers,
    sessions,
  };
}

export function lineLayout(stations: readonly Station[], options: { compact?: boolean; vertical?: boolean } = {}): LineLayout {
  if (options.vertical) return verticalLayout(stations);
  const compact = options.compact ?? false;
  const step = compact ? 44 : 124;
  const row = compact ? 30 : 72; // vertical drop of a transfer; the diagonal runs 45 degrees
  const padX = compact ? 16 : 72;
  const top = compact ? 16 : 96;
  const main = stations.filter((station) => station.kind !== 'rerun');
  const reruns = stations.filter((station) => station.kind === 'rerun');
  const sessionList = [...new Set(main.map((station) => station.session ?? 0))];

  const placed: PlacedStation[] = [];
  let x = padX;
  main.forEach((station, index) => {
    const prev = main[index - 1];
    if (prev) x += prev.session === station.session ? step : step + row;
    const level = sessionList.indexOf(station.session ?? 0);
    placed.push({ ...station, x, y: top + level * row, lines: compact ? [] : wrap(station.detail, 20, 2) });
  });

  const full = pathThrough(placed, 'x');
  const route = pathThrough(placed.filter((station) => station.route), 'x');

  let rerunPath = '';
  for (const rerun of reruns) {
    const from = placed.find((station) => station.id === rerun.rerun_of) ?? placed[placed.length - 1];
    if (!from) continue;
    const drop = compact ? 24 : 60;
    const run = compact ? 40 : 150;
    const end = { x: from.x + drop + run, y: from.y + drop };
    rerunPath += `M${from.x} ${from.y}L${from.x + drop} ${end.y}H${end.x}`;
    placed.push({ ...rerun, x: end.x, y: end.y, lines: compact ? [] : wrap('a worker, not the session', 16, 2) });
  }

  const sessions = sessionList.map((session, level) => {
    const first = placed.find((station) => (station.session ?? 0) === session && station.kind !== 'rerun')!;
    return { label: `SESSION ${session}`, x: first.x - (compact ? 0 : 12), y: top + level * row };
  });

  const maxX = Math.max(...placed.map((station) => station.x), padX);
  const maxY = Math.max(...placed.map((station) => station.y), top);
  return {
    orientation: 'horizontal',
    width: maxX + (compact ? 16 : 96),
    height: maxY + (compact ? 16 : 74),
    label_x: 0,
    time_x: 0,
    stations: placed,
    session_path: full.d,
    route_path: route.d,
    rerun_path: rerunPath,
    transfers: full.transfers,
    sessions,
  };
}
