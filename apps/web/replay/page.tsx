'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Edge, Event } from '../../../packages/core/event';
import { TopBar } from '../ui/topbar';
import { TransitLine } from '../ui/line';
import { assertionOf, clock, compileReplay, fileOf, lineLayout, type ActivityKind, type CompiledReplay, type Station, type SummaryItem } from './compile';
import type { ClaimEvent, ReplayView, ViewQuestion } from './view';

function seconds(ms: number | null): string {
  if (ms == null) return 'unknown';
  return (ms / 1000).toFixed(1);
}

function frameText(player: HTMLVideoElement): string {
  const decoded = `Decoded frame ${player.videoWidth} by ${player.videoHeight}.`;
  const box = `Player box ${player.clientWidth} by ${player.clientHeight}.`;
  if (player.videoWidth > 0 && player.videoWidth < 1000) {
    return `${decoded} ${box} The file header is smaller than the recorded frames. The player box uses the 2462 by 1582 frame so the picture can scale.`;
  }
  return `${decoded} ${box}`;
}

function shortId(id: string): string {
  return id
    .split(':')
    .map((part) => (part.length > 16 ? `${part.slice(0, part.startsWith('toolu_') ? 14 : 8)}…` : part))
    .join(':');
}

type Provenance = 'observed' | 'rule' | 'rerun' | 'developer' | 'unknown';
const PROVENANCE: Record<Provenance, string> = {
  observed: 'Observed',
  rule: 'Rule-derived',
  rerun: 'Separate re-run',
  developer: 'Developer wrote',
  unknown: 'Unknown',
};

function Chip({ kind }: { kind: Provenance }) {
  return (
    <span className={`chip chip--${kind}`}>
      <i aria-hidden="true" />
      {PROVENANCE[kind]}
    </span>
  );
}

function Block({ kind, title, children }: { kind: Provenance; title: string; children: ReactNode }) {
  return (
    <section className="ev-block">
      <h3 className="ev-head">
        <Chip kind={kind} />
        <span>{title}</span>
      </h3>
      {children}
    </section>
  );
}

function Diff({ patch, label }: { patch: string; label: string }) {
  const lines = patch.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1);
  return (
    <pre className="diff" tabIndex={0} aria-label={label}>
      {lines.map((line, index) => {
        const kind = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')
          ? 'meta'
          : line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'del'
                : 'ctx';
        return (
          <span key={index} className={`dl dl--${kind}`}>
            {line || ' '}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

function StatusMark({ status }: { status: string }) {
  return <span className={`sm sm--${status}`} aria-hidden="true" />;
}

function EventBlock({ event, heading }: { event: ClaimEvent; heading: string }) {
  return (
    <article className="chain-event">
      <h4>{heading}</h4>
      <p className="meta">Origin: {event.origin}. Event id: <code>{event.id}</code>.</p>
      <p>{event.summary}</p>
      {event.file ? <p>File: <code>{event.file}</code>.</p> : null}
      <p>{event.offset_ms == null ? 'No recording offset.' : `Recorded at ${seconds(event.offset_ms)} seconds.`}</p>
      {event.output ? <pre className="out" tabIndex={0}>{event.output}</pre> : null}
    </article>
  );
}

function ruleLines(id: string, edges: readonly Edge[]): string[] {
  const groups = new Map<string, { rel: string; by: string; provenance: string; other: number }>();
  for (const edge of edges) {
    if (edge.src !== id && edge.dst !== id) continue;
    const key = `${edge.derived_by}|${edge.rel}|${edge.provenance}|${edge.src === id ? 'out' : 'in'}`;
    const found = groups.get(key) ?? { rel: edge.rel, by: edge.derived_by, provenance: edge.provenance, other: 0 };
    found.other += 1;
    groups.set(key, found);
  }
  return [...groups.entries()].map(([key, group]) => {
    const outgoing = key.endsWith('|out');
    if (group.rel === 'supersedes') return outgoing ? `${group.by}: this edit supersedes an earlier edit (${group.provenance}).` : `${group.by}: a later edit supersedes this one (${group.provenance}). It stays on the line.`;
    if (group.rel === 'verifies') return outgoing ? `${group.by}: this pass verifies the edit before it (${group.provenance}).` : `${group.by}: a later pass verifies this edit (${group.provenance}).`;
    if (group.rel === 'failed') return outgoing ? `${group.by}: this failure is linked to the edit before it (${group.provenance}).` : `${group.by}: a later failure is linked to this edit (${group.provenance}).`;
    if (group.rel === 'ran_test') return outgoing ? `${group.by}: this test ran after the edit before it (${group.provenance}).` : `${group.by}: a test ran after this edit (${group.provenance}).`;
    if (group.rel === 'prompted') return outgoing ? `${group.by}: ${group.other} hooked tool events follow this prompt (${group.provenance}).` : `${group.by}: this event follows a prompt (${group.provenance}).`;
    return `${group.by}: ${group.rel} (${group.provenance}).`;
  });
}

function Answer({ question }: { question: ViewQuestion }) {
  if (!question.answer) return <p className="answer-none">Not answered.</p>;
  return (
    <>
      <blockquote className="answer">{question.answer.text}</blockquote>
      <p className="answer-label">
        <Chip kind="developer" />
        <span>{question.answer.label}</span>
      </p>
    </>
  );
}

function StationEvidence({
  station,
  data,
  compiled,
  onSelect,
}: {
  station: Station;
  data: ReplayView;
  compiled: CompiledReplay;
  onSelect: (id: string) => void;
}) {
  const index = data.events.findIndex((event) => event.id === station.id);
  const event = data.events[index] as Event | undefined;
  if (!event) return null;
  const output = typeof event.payload.output === 'string' ? event.payload.output : '';
  const nextEdit = station.kind === 'test_failed' ? data.events.slice(index + 1).find((item) => item.type === 'file_edit' && item.source !== 'sandbox') : undefined;
  const nextEditStation = nextEdit ? compiled.stations.find((item) => item.id === nextEdit.id) : undefined;
  const commit = data.claim.diffs.find((diff) => diff.event_ids.includes(station.id));
  const rules = ruleLines(station.id, data.edges);
  const questions = data.questions.filter((question) => question.event_ids.includes(station.id));
  const rerun = compiled.stations.find((item) => item.kind === 'rerun' && item.rerun_of === station.id);
  const hookDiff = (target: Event) => (typeof target.payload.diff === 'string' ? target.payload.diff : '');

  return (
    <div className="ev" aria-live="polite">
      <h2 className="ev-title">
        Station: {station.title} · {clock(station.offset_ms)}
      </h2>
      <p className="ev-where">
        {station.session == null ? 'A worker, not the session. ' : `Session ${station.session}. `}
        Event id <code title={station.id}>{shortId(station.id)}</code>
      </p>

      {station.kind === 'prompt' ? (
        <>
          <Block kind="observed" title="Developer prompt">
            <p className="prompt-text">{typeof event.payload.prompt === 'string' ? event.payload.prompt : 'Prompt text not stored.'}</p>
          </Block>
          <Block kind="unknown" title="Model reasoning">
            <p>{data.claim.origins.model}</p>
          </Block>
        </>
      ) : null}

      {station.kind === 'test_failed' || station.kind === 'test_passed' || station.kind === 'test_unknown' || station.kind === 'rerun' ? (
        <>
          {station.kind === 'rerun' ? (
            <Block kind="rerun" title="Worker result">
              <p className="result">
                <StatusMark status={station.detail} /> {station.detail}. Separate from the session test line.
              </p>
            </Block>
          ) : (
            <Block kind="observed" title={station.kind === 'test_failed' ? 'Assertion' : 'Test result'}>
              {station.kind === 'test_failed' ? (
                <p className="assertion">
                  <StatusMark status="failed" />
                  {assertionOf(event) ?? 'No assertion line in the output.'}
                </p>
              ) : (
                <p className="result">
                  <StatusMark status="passed" /> {station.detail}
                </p>
              )}
            </Block>
          )}
          {output ? (
            <Block kind={station.kind === 'rerun' ? 'rerun' : 'observed'} title="Test output">
              <pre className="out" tabIndex={0} aria-label="Test output">{output}</pre>
            </Block>
          ) : null}
          {rerun ? (
            <Block kind="rerun" title="Separate re-run of this test">
              <p>
                A worker re-ran this test outside the session: {rerun.detail}.{' '}
                <button type="button" className="link" onClick={() => onSelect(rerun.id)}>Open the re-run</button>
              </p>
            </Block>
          ) : null}
        </>
      ) : null}

      {nextEdit && nextEditStation ? (
        <Block kind="observed" title={`Next agent edit · ${fileOf(nextEdit) ?? 'file unknown'}${nextEditStation.superseded ? ' · superseded, kept' : ''}`}>
          <Diff patch={hookDiff(nextEdit)} label="Hook diff of the next agent edit" />
          <button type="button" className="link" onClick={() => onSelect(nextEdit.id)}>Open that edit at {clock(nextEditStation.offset_ms)}</button>
        </Block>
      ) : null}

      {station.kind === 'edit' ? (
        <>
          <Block kind="observed" title={`Hook edit · ${station.detail}${station.superseded ? ' · superseded, kept' : ''}`}>
            <Diff patch={hookDiff(event)} label="Hook diff of this edit" />
            {hookDiff(event).includes('[REDACTED]') ? <p className="note">The hook log stored an edit line as [REDACTED]. That marker is not a secret.</p> : null}
          </Block>
          {commit ? (
            <Block kind="unknown" title="Commit pairing">
              <p>
                The {commit.name} commit diff is paired with this edit by session order, which is an inference.{' '}
                <a href={`#commit-${commit.name}`}>Read the commit diff</a>
              </p>
            </Block>
          ) : null}
        </>
      ) : null}

      <Block kind="rule" title="Rule links">
        {rules.length > 0 ? (
          <ul className="rules">{rules.map((line) => <li key={line}>{line}</li>)}</ul>
        ) : (
          <p>No rule links touch this event.</p>
        )}
        <p className="not-cause">A link is not a cause.</p>
      </Block>

      {questions.length > 0 ? (
        questions.map((question) => (
          <section key={question.id} className="ev-q">
            <h3 className="ev-head">
              <Chip kind="rule" />
              <span>Q{data.questions.indexOf(question) + 1}</span>
            </h3>
            <p className="q-text">{question.text}</p>
            {data.answers_present ? <Answer question={question} /> : null}
            <p className="ids">cites {question.event_ids.map(shortId).join(', ')}</p>
          </section>
        ))
      ) : (
        <p className="note">No reviewer question cites this event.</p>
      )}
    </div>
  );
}

const LANES: { kind: ActivityKind[]; label: string }[] = [
  { kind: ['prompt'], label: 'Prompts' },
  { kind: ['tool_call'], label: 'Tool calls' },
  { kind: ['edit'], label: 'Edits' },
  { kind: ['test_failed', 'test_passed'], label: 'Tests' },
];

const KIND_WORD: Record<ActivityKind, string> = {
  prompt: 'prompt',
  tool_call: 'tool call',
  edit: 'edit',
  test_failed: 'test failed',
  test_passed: 'test passed',
};

function ActivityStrip({
  compiled,
  extent,
  time,
  selected,
  highlight,
  onPick,
}: {
  compiled: CompiledReplay;
  extent: number;
  time: number;
  selected: string | null;
  highlight: ReadonlySet<string> | null;
  onPick: (id: string) => void;
}) {
  const at = (ms: number) => `${Math.min(100, Math.max(0, (ms / extent) * 100))}%`;
  return (
    <figure className="activity" aria-labelledby="activity-title">
      <figcaption id="activity-title" className="activity-title">Activity over the recording</figcaption>
      <div className="lanes">
        {LANES.map((lane) => {
          const points = compiled.activity.filter((point) => lane.kind.includes(point.kind));
          return (
            <div key={lane.label} className="lane" role="group" aria-label={`${lane.label}: ${points.length}`}>
              <span className="lane-label" aria-hidden="true">{lane.label}</span>
              <span className="lane-track">
                {points.map((point) => (
                  <button
                    type="button"
                    key={point.id}
                    className={`pt pt--${point.kind}`}
                    aria-label={`${KIND_WORD[point.kind]} at ${clock(point.offset_ms)}`}
                    aria-pressed={point.id === selected}
                    data-dim={highlight && !highlight.has(point.id) ? 'true' : undefined}
                    style={{ left: at(point.offset_ms) }}
                    onClick={() => onPick(point.id)}
                  >
                    <i aria-hidden="true" />
                  </button>
                ))}
                <span className="playhead" aria-hidden="true" style={{ left: at(time) }} />
              </span>
            </div>
          );
        })}
        <div className="lane lane--axis" aria-hidden="true">
          <span className="lane-label" />
          <span className="lane-track axis">
            <span style={{ left: '0%' }}>0:00</span>
            {time / extent > 0.05 && time / extent < 0.93 ? <span className="axis-now" style={{ left: at(time) }}>{clock(time)}</span> : null}
            <span style={{ left: '100%' }}>{clock(extent)}</span>
          </span>
        </div>
      </div>
    </figure>
  );
}

// Outcome counts lead; the rest sit behind a disclosure on narrow screens.
const LEAD = ['failed', 'passed', 'first_fail_pass', 'rerun'];

function SummaryBand({
  items,
  active,
  onPick,
}: {
  items: SummaryItem[];
  active: string | null;
  onPick: (item: SummaryItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const ordered = [...items.filter((item) => LEAD.includes(item.key)), ...items.filter((item) => !LEAD.includes(item.key))];
  return (
    <>
      <ul id="summary-list" className="summary-list" data-open={open ? 'true' : undefined}>
        {ordered.map((item) => (
          <li key={item.key} className={`sum sum--${item.key}${LEAD.includes(item.key) ? ' sum--lead' : ''}`}>
            {item.href ? (
              <a className="sum-hit" href={item.href}>
                <span className="sum-label">{item.label}</span>
                <span className="sum-value">{item.value}</span>
                {item.note ? <span className="sum-note">{item.note}</span> : null}
              </a>
            ) : (
              <button type="button" className="sum-hit" aria-pressed={active === item.key} disabled={item.event_ids.length === 0} onClick={() => onPick(item)}>
                <span className="sum-label">{item.label}</span>
                <span className="sum-value">{item.value}</span>
                {item.note ? <span className="sum-note">{item.note}</span> : null}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="link summary-toggle" aria-expanded={open} aria-controls="summary-list" onClick={() => setOpen(!open)}>
        {open ? 'Show fewer counts' : `Show all ${items.length} counts`}
      </button>
    </>
  );
}

function ToolCallEvidence({ event, data }: { event: Event; data: ReplayView }) {
  const tool = typeof event.payload.tool_name === 'string' ? event.payload.tool_name : 'unknown tool';
  const phase = typeof event.payload.phase === 'string' ? event.payload.phase : 'unknown';
  const rules = ruleLines(event.id, data.edges);
  return (
    <div className="ev" aria-live="polite">
      <h2 className="ev-title">Tool call: {tool} · {clock(typeof event.media_offset_ms === 'number' ? event.media_offset_ms : null)}</h2>
      <p className="ev-where">Event id <code title={event.id}>{shortId(event.id)}</code></p>
      <Block kind="observed" title="Hooked tool event">
        <p>{tool}, hook phase {phase}. The hook stores the call, not the reasoning behind it.</p>
      </Block>
      <Block kind="rule" title="Rule links">
        {rules.length > 0 ? <ul className="rules">{rules.map((line) => <li key={line}>{line}</li>)}</ul> : <p>No rule links touch this event.</p>}
        <p className="not-cause">A link is not a cause.</p>
      </Block>
      <p className="note">Pick a station on the line to see its test, diff, and question.</p>
    </div>
  );
}

export default function ReplayPage() {
  const [data, setData] = useState<ReplayView | null>(null);
  const [error, setError] = useState('');
  const [seekNote, setSeekNote] = useState('The recording is ready. Pick a station to move it.');
  const [frameNote, setFrameNote] = useState('Waiting for the recording frame.');
  const [selected, setSelected] = useState<string | null>(null);
  const [toolEvent, setToolEvent] = useState<string | null>(null);
  const [filter, setFilter] = useState<SummaryItem | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const offline = new URLSearchParams(location.search).get('offline') === '1';
    fetch(`/api/replay${offline ? '?offline=1' : ''}`)
      .then((response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json() as Promise<ReplayView>;
      })
      .then((body) => {
        if (!body?.claim || !body.media?.url) throw new Error('incomplete');
        setData(body);
        setSelected(body.claim.failure.id);
      })
      .catch(() => setError('Replay unavailable. Restart the local demo.'));
  }, []);

  const compiled = useMemo(() => (data ? compileReplay(data) : null), [data]);
  const layout = useMemo(() => (compiled ? lineLayout(compiled.stations) : null), [compiled]);
  const vertical = useMemo(() => (compiled ? lineLayout(compiled.stations, { vertical: true }) : null), [compiled]);
  const highlight = useMemo(() => (filter ? new Set(filter.event_ids) : null), [filter]);

  function seekTo(ms: number | null) {
    const player = video.current;
    if (!player || ms == null) {
      setSeekNote('Seek unknown.');
      return;
    }
    const target = ms / 1000;
    pending.current = target;
    const apply = () => {
      if (!video.current || pending.current == null) return;
      video.current.currentTime = pending.current;
      setSeekNote(`Player time set to ${pending.current.toFixed(1)} seconds.`);
    };
    if (player.readyState >= 1) apply();
    else player.addEventListener('loadedmetadata', apply, { once: true });
    player.scrollIntoView({ block: 'nearest' });
  }

  function selectStation(id: string) {
    const station = compiled?.stations.find((item) => item.id === id);
    if (!station) return;
    setSelected(id);
    setToolEvent(null);
    if (station.offset_ms == null) setSeekNote('This event has no footage. The separate re-run ran outside the recording.');
    else seekTo(station.offset_ms);
  }

  function pickActivity(id: string) {
    if (compiled?.stations.some((item) => item.id === id)) {
      selectStation(id);
      return;
    }
    const event = data?.events.find((item) => item.id === id);
    if (!event) return;
    setToolEvent(id);
    seekTo(typeof event.media_offset_ms === 'number' ? event.media_offset_ms : null);
  }

  function pickSummary(item: SummaryItem) {
    if (filter?.key === item.key) {
      setFilter(null);
      return;
    }
    setFilter(item);
    const first = compiled?.stations.find((station) => item.event_ids.includes(station.id));
    if (first) selectStation(first.id);
  }

  if (!data || !compiled || !layout || !vertical) {
    return (
      <>
        <TopBar place="replay" />
        <main id="main" className="page loading">
          <p role="status">{error || 'Loading golden take…'}</p>
        </main>
      </>
    );
  }

  const claim = data.claim;
  const station = compiled.stations.find((item) => item.id === selected) ?? compiled.stations[0];
  const extent = Math.max(compiled.last_offset_ms, duration ?? 0, 1);
  const verifies = claim.rules.find((rule) => rule.rel === 'verifies');
  const verifiedEdits = verifies ? compiled.stations.filter((item) => item.kind === 'edit' && verifies.evidence_event_ids.includes(item.id)) : [];
  const shownTests = compiled.tests;
  const pickedTool = toolEvent ? data.events.find((item) => item.id === toolEvent) : undefined;

  return (
    <>
      <TopBar
        place="replay"
        take={
          <>
            <b>{data.label}</b> · {data.mode} · consented take · audio and camera off
          </>
        }
      />
      <main id="main" className="page replay">
        <div className="summary-head">
          <h1 id="take-title">{data.label}</h1>
          <p className="summary-sub">
            {data.warning} This page plays a finished take. It does not record.
          </p>
        </div>
        <p className="limits-strip">
          <b>No verdict on the developer.</b> Not captured: {data.not_captured.join(', ')}. <a href="#limits">Unknowns and limits</a>
        </p>
        <section className="band summary" aria-label="Session summary: counts and times only">
          <p className="summary-how">Counts and times only. Select one to mark the events it counts.</p>
          <SummaryBand items={compiled.summary} active={filter?.key ?? null} onPick={pickSummary} />
          {filter ? (
            <p className="filter-note" role="status">
              Marking the {filter.event_ids.length} events counted in “{filter.label}”.{' '}
              <button type="button" className="link" onClick={() => setFilter(null)}>Show all events</button>
            </p>
          ) : null}
        </section>

        <section className="band corridor" aria-labelledby="route-title">
          <h2 id="route-title">Failure to pass</h2>
          <div className="line-scroll line-wide">
            <TransitLine
              layout={layout}
              label="The take as a line. Each station is a recorded event. Select one to seek the recording and open its evidence."
              selected={station.id}
              highlight={highlight}
              onSelect={selectStation}
            />
          </div>
          <div className="line-narrow">
            <TransitLine
              layout={vertical}
              label="The take as a line, top to bottom. Each station is a recorded event. Select one to seek the recording and open its evidence."
              selected={station.id}
              highlight={highlight}
              onSelect={selectStation}
            />
          </div>
          <div className="line-foot">
            <ul className="legend" aria-label="Line key">
              <li><span className="key key--route" aria-hidden="true" />Fail to pass route</li>
              <li><span className="key key--session" aria-hidden="true" />Session line, kept in full</li>
              <li><span className="key key--rerun" aria-hidden="true" />Separate re-run line</li>
            </ul>
            <div className="corridor-actions">
              <button type="button" className="btn" onClick={() => selectStation(claim.failure.id)}>
                Open the first failed test at {seconds(claim.failure.offset_ms)} seconds
              </button>
              <button type="button" className="btn" onClick={() => selectStation(claim.pass.id)}>
                Seek to the passing test at {seconds(claim.pass.offset_ms)} seconds
              </button>
            </div>
            <p className="line-note">
              {verifies
                ? `Thick route: ${verifies.derived_by} links the passing test to ${verifiedEdits.length} ${verifiedEdits.length === 1 ? 'edit' : 'edits'} before it (${verifies.provenance}). A link is not a cause.`
                : 'No rule links the passing test to an edit. A link is not a cause.'}
            </p>
          </div>
        </section>

        <section className="band lower" aria-label="Recording and station evidence">
          <div className="player">
            <div className="video-frame">
              <span className="video-tag" aria-hidden="true">Recording · audio off · camera off</span>
              {/* The WebM header is 238x152. Later frames are 2462x1582. Size the box to the real frame. */}
              <video
                ref={video}
                src={data.media.url}
                controls
                aria-label="Recording of the Claude Code terminal"
                preload="metadata"
                playsInline
                width={2462}
                height={1582}
                className="video"
                onLoadedMetadata={() => {
                  if (!video.current) return;
                  setFrameNote(frameText(video.current));
                  if (Number.isFinite(video.current.duration)) setDuration(video.current.duration * 1000);
                }}
                onTimeUpdate={() => { if (video.current) setTime(video.current.currentTime * 1000); }}
                onSeeked={() => {
                  const player = video.current;
                  if (!player) return;
                  setTime(player.currentTime * 1000);
                  setSeekNote(`Player time is ${player.currentTime.toFixed(1)} seconds.`);
                  setFrameNote(frameText(player));
                }}
                onError={() => setError('Media unavailable. Reload to refresh the short-lived URL.')}
              />
            </div>
            <ActivityStrip compiled={compiled} extent={extent} time={time} selected={toolEvent ?? station.id} highlight={highlight} onPick={pickActivity} />
            <p className="seek" role="status">{error || seekNote}</p>
            <p className="note">Claude Code collapses tool output on screen. At a seek point the failing or passing output may not be visible. The log text is the evidence.</p>
            <p className="note frame">{frameNote}</p>
          </div>
          {pickedTool ? <ToolCallEvidence event={pickedTool} data={data} /> : <StationEvidence station={station} data={data} compiled={compiled} onSelect={selectStation} />}
        </section>

        <section id="limits" className="limits" aria-label="Limits of this take">
          <div className="limits-unknowns">
            <h2>Unknowns</h2>
            <ul>{data.unknowns.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div className="limits-missing">
            <h2>Not captured</h2>
            <p>This take did not capture:</p>
            <ul>{data.not_captured.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          {data.usage ? (
            <p className="limits-usage">
              <b>Coding-agent usage, context only:</b> {data.usage.requests} requests · {data.usage.models.join(', ')} · about ${data.usage.list_price_usd.toFixed(2)} list-price equivalent · billed to the {data.usage.billing_route_label}. <a href="#usage">Read the usage table</a>
            </p>
          ) : null}
        </section>

        <section className="band tests" aria-labelledby="tests-title">
          <h2 id="tests-title">Test history</h2>
          <p className="section-sub">Every test run in take order. The separate re-run is its own row, apart from the session test line.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="tests-title">
            <table className="test-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Status</th>
                  <th scope="col">Failing assertion</th>
                  <th scope="col">Time</th>
                  <th scope="col">Session</th>
                  <th scope="col">Edit before it</th>
                </tr>
              </thead>
              <tbody>
                {shownTests.map((row) => (
                  <tr key={row.id} data-rerun={row.rerun ? 'true' : undefined} data-selected={row.id === station.id ? 'true' : undefined} data-dim={highlight && !highlight.has(row.id) ? 'true' : undefined}>
                    <th scope="row">{row.rerun ? 'Separate re-run' : `Test ${row.n}`}</th>
                    <td data-label="Status"><span className="status"><StatusMark status={row.status} />{row.status}</span></td>
                    <td className="mono" data-label="Failing assertion">{row.assertion ?? (row.status === 'failed' ? 'no assertion line' : 'none')}</td>
                    <td data-label="Time">
                      <button type="button" className="link tc" aria-label={`Open ${row.rerun ? 'the separate re-run' : `test ${row.n}`}${row.offset_ms == null ? '' : ` at ${clock(row.offset_ms)}`}`} onClick={() => selectStation(row.id)}>
                        {clock(row.offset_ms)}
                      </button>
                    </td>
                    <td data-label="Session">{row.session == null ? 'a worker, not the session' : `Session ${row.session}`}</td>
                    <td data-label="Edit before it">
                      {row.edit_before ? (
                        <button type="button" className="link" onClick={() => selectStation(row.edit_before!.id)}>
                          {row.edit_before.file ?? 'file unknown'}, session {row.edit_before.session}
                        </button>
                      ) : (
                        'none before it'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="questions" className="band questions" aria-labelledby="questions-title">
          <h2 id="questions-title">Questions</h2>
          <p className="section-sub">Each question comes from a fixed rule over the recorded events. {claim.answer_note}</p>
          <ol className="q-list">
            {data.questions.map((question, index) => (
              <li key={question.id} className="q-item">
                <h3 className="ev-head">
                  <Chip kind="rule" />
                  <span>Q{index + 1}</span>
                </h3>
                <p className="q-text">{question.text}</p>
                {data.answers_present ? (
                  <>
                    {question.answer ? (
                      <>
                        <blockquote className="answer">{question.answer.text}</blockquote>
                        <p className="answer-label"><Chip kind="developer" /><span>{question.answer.label}</span></p>
                      </>
                    ) : (
                      <p className="answer-none">Not answered.</p>
                    )}
                  </>
                ) : null}
                <p className="meta">Origin: rule derived, {question.rule_id}. No model call.</p>
                <ul className="cites" aria-label={`Events cited by Q${index + 1}`}>
                  {question.event_ids.map((id) => {
                    const event = data.events.find((item) => item.id === id);
                    const isStation = compiled.stations.some((item) => item.id === id);
                    return (
                      <li key={id}>
                        {isStation ? (
                          <button type="button" className="link mono" title={id} onClick={() => selectStation(id)}>{shortId(id)}</button>
                        ) : (
                          <code title={id}>{shortId(id)}</code>
                        )}
                        {event ? ` · ${event.type} · ${event.source}` : ''}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        {data.usage ? (
          <section id="usage" className="band usage" aria-label="Coding-agent usage (context)">
            <h2>Coding-agent usage (context)</h2>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Usage table">
              <table className="usage-table">
                <thead>
                  <tr><th>Requests</th><th>Model</th><th>Input tokens</th><th>Output tokens</th><th>Cache write 1h</th><th>Cache write 5m</th><th>Cache read</th><th>List-price equivalent (USD)</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label="Requests">{data.usage.requests}</td>
                    <td data-label="Model">{data.usage.models.join(', ')}</td>
                    <td data-label="Input tokens">{data.usage.input_tokens.toLocaleString('en-US')}</td>
                    <td data-label="Output tokens">{data.usage.output_tokens.toLocaleString('en-US')}</td>
                    <td data-label="Cache write 1h">{data.usage.cache_write_1h.toLocaleString('en-US')}</td>
                    <td data-label="Cache write 5m">{data.usage.cache_write_5m.toLocaleString('en-US')}</td>
                    <td data-label="Cache read">{data.usage.cache_read.toLocaleString('en-US')}</td>
                    <td data-label="List-price equivalent (USD)">${data.usage.list_price_usd.toFixed(4)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>Billing route: {data.usage.billing_route_label}. Price table: {data.usage.price_table} ({data.usage.price_table_date}).</p>
            <p>{data.usage.note}</p>
          </section>
        ) : null}

        <section className="band chain" aria-label="Cited evidence">
          <h2>Commits, re-run, and rules</h2>
          <p className="section-sub">The sources behind the line: git commits, the worker re-run, and the rule edges.</p>
          <div className="chain-grid">
            <div className="chain-events">
              {claim.diffs.map((diff) => (
                <figure key={diff.name} id={`commit-${diff.name}`} className="commit">
                  <figcaption>
                    <Chip kind="observed" /> <b>{diff.name}</b>. commit diff, from git, not from the hook log. Paired with these hooked edits by session order, which is an inference: {diff.event_ids.map(shortId).join(', ')}.
                  </figcaption>
                  {diff.hook_redacted ? <p className="note">The hook log stored an edit line as [REDACTED]. That marker is not a secret.</p> : null}
                  <Diff patch={diff.patch} label={`${diff.name} commit diff`} />
                </figure>
              ))}
            </div>
            <div className="chain-side">
              <section aria-label="Worker re-run" className="rerun-box">
                <h3><Chip kind="rerun" /> Worker re-run</h3>
                <p>Separate from the session test line.</p>
                <EventBlock event={claim.rerun} heading="Sandbox result" />
              </section>
              <h3>Rules</h3>
              <p>A rule edge comes from a fixed rule applied to recorded events. Observed means a separate sandbox re-run gave the same result. Inferred means no re-run confirmed it, so the link rests on event order. Neither is a cause.</p>
              <ul className="rules">
                {claim.rules.map((rule) => (
                  <li key={rule.id}>
                    {rule.rel}. Rule {rule.derived_by}. {rule.provenance}. From <code title={rule.src}>{shortId(rule.src)}</code> to <code title={rule.dst}>{shortId(rule.dst)}</code>. Evidence: {rule.evidence_event_ids.map(shortId).join(', ')}.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
      <aside className="pinned" aria-label="Limits, short form">
        <span><b>Not captured:</b> {data.not_captured.join(' · ')}</span>
        <a href="#limits">Unknowns ({data.unknowns.length})</a>
      </aside>
    </>
  );
}
