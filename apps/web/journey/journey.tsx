'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { Edge, Event } from '../../../packages/core/event';
import { agentLabel, type ChainStep, type Journey, type JourneyKind, type JourneyStation } from './build';
import type { JourneyLayout, Placed } from './layout';
import styles from './journey.module.css';

export function clock(ms: number | null): string {
  if (ms == null) return 'no footage';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function wall(ts: string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const KIND_WORD: Record<JourneyKind, string> = {
  start: 'Start',
  prompt: 'Developer prompt',
  agent_prompt: 'Agent-written prompt',
  response: 'Developer response',
  actions: 'Agent actions',
  edit: 'Code change',
  unattributed: 'Unattributed change',
  test_failed: 'Test failed',
  test_passed: 'Test passed',
  test_unknown: 'Test, status unknown',
  switch: 'Model switch',
  answer: 'Developer answer',
  verified: 'Independent verification',
  verify_failed: 'Independent re-run',
};

// Shape and colour together, so a station never relies on colour alone.
function Mark({ station }: { station: Placed }) {
  const { x, y } = station;
  switch (station.kind) {
    case 'start':
      return (
        <g className={styles.mkStart}>
          <circle cx={x} cy={y} r={11} />
          <circle className={styles.mkStartDot} cx={x} cy={y} r={4} />
        </g>
      );
    case 'prompt':
      return <rect className="mk mk-prompt" x={x - 9} y={y - 9} width={18} height={18} />;
    case 'agent_prompt':
      return <rect className={styles.mkAgentPrompt} x={x - 9} y={y - 9} width={18} height={18} />;
    case 'response':
      return (
        <g className={styles.mkResponse}>
          <rect x={x - 10} y={y - 10} width={20} height={20} />
          <path d={`M${x - 4} ${y + 10}L${x - 4} ${y + 17}L${x + 4} ${y + 10}`} />
        </g>
      );
    case 'actions':
      return <circle className={styles.mkActions} cx={x} cy={y} r={7} />;
    case 'edit':
      return <rect className="mk mk-edit" x={x - 8} y={y - 8} width={16} height={16} transform={`rotate(45 ${x} ${y})`} />;
    case 'unattributed':
      return (
        <g className={styles.mkUnattributed}>
          <rect x={x - 8} y={y - 8} width={16} height={16} transform={`rotate(45 ${x} ${y})`} />
          <text x={x} y={y + 4} textAnchor="middle">?</text>
        </g>
      );
    case 'test_failed':
      return (
        <g className="mk-failed">
          <circle cx={x} cy={y} r={12} />
          <path d={`M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`} />
        </g>
      );
    case 'test_passed':
      return (
        <g className="mk-passed">
          <circle className="mk-terminus" cx={x} cy={y} r={19} />
          <circle className="mk-disc" cx={x} cy={y} r={13} />
          <path d={`M${x - 6} ${y}L${x - 1.5} ${y + 4.5}L${x + 6.5} ${y - 4.5}`} />
        </g>
      );
    case 'switch':
      return (
        <g className={styles.mkSwitch}>
          <circle cx={x} cy={y} r={12} />
          <path d={`M${x - 6} ${y - 3}H${x + 5}M${x + 2} ${y - 6}L${x + 5} ${y - 3}L${x + 2} ${y}M${x + 6} ${y + 3}H${x - 5}M${x - 2} ${y}L${x - 5} ${y + 3}L${x - 2} ${y + 6}`} />
        </g>
      );
    case 'answer':
      return <rect className={styles.mkAnswer} x={x - 10} y={y - 8} width={20} height={16} rx={6} />;
    case 'verified':
    case 'verify_failed':
      return (
        <g className={styles.mkRerun}>
          <rect x={x - 12} y={y - 12} width={24} height={24} rx={2} />
          {station.kind === 'verified' ? <path d={`M${x - 6} ${y}L${x - 1.5} ${y + 4.5}L${x + 6.5} ${y - 4.5}`} /> : <path d={`M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`} />}
        </g>
      );
    default:
      return <circle className="mk mk-unknown" cx={x} cy={y} r={9} />;
  }
}

function stationLabel(station: JourneyStation): string {
  const when = station.offset_ms == null ? 'no recording time' : `recording time ${clock(station.offset_ms)}`;
  const derived = station.derived ? ' Derived station.' : '';
  return `${KIND_WORD[station.kind]}: ${station.title}, ${station.detail}. ${when}.${derived}`;
}

export function JourneyLine({ layout, selected, onSelect, chainOnly }: { layout: JourneyLayout; selected: string | null; onSelect: (id: string) => void; chainOnly: boolean }) {
  const keyed = (id: string) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(id);
    }
  };
  return (
    <svg className={styles.line} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Development journey. Each station is a recorded event or a labeled group of recorded events, in time order. Select a station to open its evidence." data-chain-only={chainOnly ? 'true' : undefined}>
      <path className={styles.lnMain} d={layout.line} />
      <path className={styles.lnChain} d={layout.chain} />
      <path className={styles.lnBranch} d={layout.branches} />
      {layout.stations.map((station) => {
        const dim = chainOnly && !station.chain && !station.branch;
        const big = station.kind === 'test_passed';
        const labelTop = station.y - (big ? 30 : 24);
        return (
          <g
            key={station.id}
            className={`st ${styles.st}`}
            data-kind={station.kind}
            data-dim={dim ? 'true' : undefined}
            data-selected={station.id === selected ? 'true' : undefined}
            data-derived={station.derived ? 'true' : undefined}
            role="button"
            tabIndex={0}
            aria-pressed={station.id === selected}
            aria-label={stationLabel(station)}
            onClick={() => onSelect(station.id)}
            onKeyDown={keyed(station.id)}
          >
            <circle className="st-hit" cx={station.x} cy={station.y} r={38} />
            <circle className="st-ring" cx={station.x} cy={station.y} r={big ? 26 : 21} />
            <Mark station={station} />
            <text className={styles.title} x={station.x} y={labelTop} textAnchor="middle">
              {station.title}
            </text>
            {station.lines.map((line, index) => (
              <text key={index} className={styles.detail} x={station.x} y={station.y + (big ? 36 : 32) + index * 14} textAnchor="middle">
                {line}
              </text>
            ))}
            <text className={styles.time} x={station.x} y={station.y + (big ? 36 : 32) + station.lines.length * 14 + 4} textAnchor="middle">
              {station.branch ? 'no footage' : clock(station.offset_ms)}
            </text>
            {station.superseded ? (
              <text className={styles.stamp} x={station.x} y={labelTop - 14} textAnchor="middle">SUPERSEDED</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend() {
  const item = (kind: JourneyKind, shape: ReactNode) => (
    <li key={kind}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">{shape}</svg>
      {KIND_WORD[kind]}
    </li>
  );
  return (
    <ul className={styles.legend} aria-label="Station key">
      {item('prompt', <rect className="mk mk-prompt" x={4} y={4} width={14} height={14} />)}
      {item('response', <rect className={styles.mkResponseKey} x={4} y={4} width={14} height={14} />)}
      {item('agent_prompt', <rect className={styles.mkAgentPrompt} x={4} y={4} width={14} height={14} />)}
      {item('actions', <circle className={styles.mkActions} cx={11} cy={11} r={6} />)}
      {item('edit', <rect className="mk mk-edit" x={5} y={5} width={12} height={12} transform="rotate(45 11 11)" />)}
      {item('test_failed', <g className="mk-failed"><circle cx={11} cy={11} r={8} /><path d="M7.5 7.5L14.5 14.5M14.5 7.5L7.5 14.5" /></g>)}
      {item('test_passed', <g className="mk-passed"><circle className="mk-disc" cx={11} cy={11} r={9} /><path d="M7 11L10 14L15.5 8" /></g>)}
      {item('verified', <g className={styles.mkRerun}><rect x={3} y={3} width={16} height={16} rx={2} /><path d="M7 11L10 14L15.5 8" /></g>)}
      {item('unattributed', <g className={styles.mkUnattributed}><rect x={5} y={5} width={12} height={12} transform="rotate(45 11 11)" /></g>)}
      {item('switch', <g className={styles.mkSwitch}><circle cx={11} cy={11} r={8} /></g>)}
      <li><span className={styles.keyChain} aria-hidden="true" />Failure-to-fix chain</li>
      <li><span className={styles.keyBranch} aria-hidden="true" />Separate re-run, outside the session</li>
    </ul>
  );
}

export function ChainStrip({ chain, selected, onSelect }: { chain: readonly ChainStep[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <ol className={styles.chain} aria-label="Failure to fix, step by step">
      {chain.map((step, index) => (
        <li key={step.key} className={styles.chainStep} data-missing={step.station ? undefined : 'true'} data-selected={step.station != null && step.station === selected ? 'true' : undefined}>
          <span className={styles.chainNo} aria-hidden="true">{index + 1}</span>
          {step.station ? (
            <button type="button" className={styles.chainButton} onClick={() => onSelect(step.station!)}>
              <b>{step.label}</b>
              <span>{step.note}</span>
            </button>
          ) : (
            <div className={styles.chainButton}>
              <b>{step.label}</b>
              <span>{step.note}</span>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Diff({ patch, label }: { patch: string; label: string }) {
  const lines = patch.split('\n');
  return (
    <pre className="diff" tabIndex={0} aria-label={label}>
      {lines.map((line, index) => {
        const kind = /^(\+\+\+|---|diff |index )/.test(line) ? 'meta' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
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

type Prov = 'observed' | 'rule' | 'rerun' | 'developer' | 'unknown';
const PROV: Record<Prov, string> = { observed: 'Observed', rule: 'Derived', rerun: 'Separate re-run', developer: 'Developer wrote', unknown: 'Unattributed' };

export function Chip({ kind, text }: { kind: Prov; text?: string }) {
  return (
    <span className={`chip chip--${kind}`}>
      <i aria-hidden="true" />
      {text ?? PROV[kind]}
    </span>
  );
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sourceWord(event: Event): string {
  if (event.source === 't3_code') return 'T3 Code store';
  if (event.source === 'claude_code_hook') return 'Claude Code hook';
  if (event.source === 'sandbox') return 'sandbox worker';
  return event.source;
}

function Ids({ event }: { event: Event }) {
  const t3 = (event.payload.t3 ?? null) as Record<string, unknown> | null;
  return (
    <dl className={styles.ids}>
      <dt>DevLens event</dt>
      <dd><code title={event.id}>{event.id}</code></dd>
      {event.tool_use_id ? (<><dt>Provider tool id</dt><dd><code>{event.tool_use_id}</code></dd></>) : null}
      {t3 && str(t3.turn_item_id) ? (<><dt>T3 turn item</dt><dd><code>{str(t3.turn_item_id)}</code></dd></>) : null}
      {t3 && str(t3.run_id) ? (<><dt>T3 run</dt><dd><code>{str(t3.run_id)}</code></dd></>) : null}
      <dt>Source</dt>
      <dd>{sourceWord(event)} · {event.provenance} · {wall(event.ts)}</dd>
    </dl>
  );
}

function EventCard({ event }: { event: Event }) {
  const p = event.payload;
  const sandbox = event.source === 'sandbox';
  let body: ReactNode = null;
  if (event.type === 'prompt') {
    body = (
      <>
        <blockquote className={styles.prompt}>{str(p.prompt) || 'empty prompt'}</blockquote>
        <p className="note">{event.actor === 'developer' ? 'Written by the developer, word for word after redaction.' : `Written by ${event.actor === 'agent' ? 'an agent' : 'an unknown author'}, not the developer${str(p.created_by) ? ` (recorded as createdBy=${str(p.created_by)})` : ''}.`}</p>
      </>
    );
  } else if (event.type === 'test') {
    body = (
      <>
        <p className={styles.cmd}><b>{str(p.status) || 'unknown'}</b> · <code>{str(p.command)}</code></p>
        <p className="note">Status from {p.signal === 'rerun' ? 'a separate sandbox re-run' : p.signal === 'provider_status' ? 'the provider failure flag (output unclear)' : p.signal === 'hook_failure' ? 'the hook failure event' : 'the test output'}.{p.rerun_of ? ` Re-run of ${str(p.rerun_of)}.` : ''}</p>
        {str(p.output) ? <pre className="out" tabIndex={0}>{str(p.output)}</pre> : <p className="note">No output was captured.</p>}
      </>
    );
  } else if (event.type === 'file_edit') {
    const files = Array.isArray(p.files) ? p.files.map(String) : [];
    body = (
      <>
        <p className={styles.cmd}>{files.map((file) => <code key={file}>{file}</code>)}</p>
        {event.actor === 'unknown' ? <p className="note">{str(p.basis) || 'No capture names who made this change.'}</p> : null}
        {str(p.diff) ? <Diff patch={str(p.diff)} label={`Edit to ${files.join(', ')}`} /> : event.actor !== 'unknown' ? <p className="note">The provider did not expose the change text. The file name is known.</p> : null}
        {str(p.diff_format) && str(p.diff) ? <p className="note">Shape reported by the provider: {str(p.diff_format).replace('_', ' ')}.</p> : null}
      </>
    );
  } else if (event.type === 'tool_call') {
    const name = str(p.tool_name) || str((p.raw as Record<string, unknown> | undefined)?.tool_name) || 'tool';
    body = (
      <>
        <p className={styles.cmd}><b>{name}</b>{str(p.title) ? ` · ${str(p.title)}` : ''}{str(p.command) ? <> · <code>{str(p.command).slice(0, 300)}</code></> : null}</p>
        {str(p.output) ? <pre className="out" tabIndex={0}>{str(p.output)}</pre> : null}
      </>
    );
  } else if (event.type === 'checkpoint') {
    const files = Array.isArray(p.files) ? (p.files as Record<string, unknown>[]) : [];
    body = (
      <>
        <p className="note">T3 Code stores a hidden git ref after each run. This is what git saw, not what the provider reported.</p>
        <ul className={styles.files}>{files.map((file, index) => <li key={`${str(file.path)}-${index}`}><code>{str(file.path)}</code> {str(file.kind)} {file.additions != null ? `+${String(file.additions)} -${String(file.deletions)}` : ''}</li>)}</ul>
        {str(p.git_diff) ? (<><p className="note">{str(p.git_diff_basis)}</p><Diff patch={str(p.git_diff)} label="Git diff between T3 checkpoints" /></>) : <p className="note">No git diff was read for this checkpoint.</p>}
      </>
    );
  } else if (event.type === 'answer') {
    body = <blockquote className={styles.prompt}>{str(p.answer) || str(p.text)}</blockquote>;
  }
  const kind: Prov = sandbox ? 'rerun' : event.actor === 'unknown' ? 'unknown' : event.type === 'prompt' && event.actor === 'developer' ? 'developer' : event.provenance === 'inferred' ? 'rule' : 'observed';
  return (
    <article className={styles.card}>
      <h4 className="ev-head">
        <Chip kind={kind} />
        <span>{event.type.replace('_', ' ')}{event.type === 'checkpoint' ? ' (git)' : ''}</span>
      </h4>
      {body}
      <Ids event={event} />
    </article>
  );
}

function ruleLines(ids: readonly string[], edges: readonly Edge[]): { text: string; provenance: string }[] {
  const set = new Set(ids);
  const seen = new Set<string>();
  const out: { text: string; provenance: string }[] = [];
  for (const edge of edges) {
    if (!set.has(edge.src) && !set.has(edge.dst)) continue;
    if (edge.rel === 'prompted') continue; // one per tool event; the time order already shows it
    const outgoing = set.has(edge.src);
    const key = `${edge.derived_by}|${edge.rel}|${outgoing}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verb: Record<string, [string, string]> = {
      verifies: ['this pass verifies an earlier edit', 'a later pass verifies this edit'],
      supersedes: ['this edit supersedes an earlier edit', 'a later edit supersedes this one; it stays on the line'],
      failed: ['this failure is linked to the edit before it', 'a later failure is linked to this edit'],
      ran_test: ['this test ran after the edit before it', 'a test ran after this edit'],
      edited: ['this tool call produced this edit', 'this edit came from that tool call'],
    };
    const pair = verb[edge.rel];
    out.push({ text: `${edge.derived_by}: ${pair ? pair[outgoing ? 0 : 1] : edge.rel}.`, provenance: edge.provenance });
  }
  return out;
}

export function EvidencePanel({ station, events, edges, canSeek, onSeek }: { station: JourneyStation; events: readonly Event[]; edges: readonly Edge[]; canSeek: boolean; onSeek: (ms: number) => void }) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const own = station.event_ids.map((id) => byId.get(id)).filter((event): event is Event => event != null);
  const context = station.context_ids.map((id) => byId.get(id)).filter((event): event is Event => event != null);
  const shown = station.kind === 'actions' ? own.slice(0, 8) : own.slice(0, 6);
  const rules = ruleLines(station.event_ids, edges);
  return (
    <div className={styles.evidence} aria-live="polite">
      <h2 className="ev-title">{KIND_WORD[station.kind]} · {station.branch ? 'no footage' : clock(station.offset_ms)}</h2>
      <p className="ev-where">
        {station.session > 0 ? `Session ${station.session}` : 'Outside the session'}
        {station.run != null ? ` · run ${station.run}` : ''} · {wall(station.ts)}
        {station.agent ? <> · <b>{agentLabel(station.agent)}</b> <span className={styles.basis}>({station.agent.basis})</span></> : null}
      </p>
      <div className={styles.seekRow}>
        {station.offset_ms != null && canSeek ? (
          <button type="button" className="btn" onClick={() => onSeek(station.offset_ms!)}>Play the recording from {clock(station.offset_ms)}</button>
        ) : (
          <p className="note">{station.branch ? 'The re-run ran outside the recording.' : canSeek ? 'This event is outside the recording window.' : 'No recording is attached to this session.'}</p>
        )}
      </div>
      {station.derived ? (
        <p className={styles.derived}><Chip kind="rule" /> {station.derived}</p>
      ) : null}
      {shown.map((event) => <EventCard key={event.id} event={event} />)}
      {own.length > shown.length ? <p className="note">And {own.length - shown.length} more recorded events in this station.</p> : null}
      {context.length > 0 ? (
        <details className={styles.context}>
          <summary>Context: {context.filter((event) => event.type === 'checkpoint').length > 0 ? 'git checkpoint and ' : ''}{context.filter((event) => event.type !== 'checkpoint').length} tool calls around these edits</summary>
          {context.slice(0, 10).map((event) => <EventCard key={event.id} event={event} />)}
        </details>
      ) : null}
      <section className={styles.rules}>
        <h3 className="ev-head"><Chip kind="rule" /><span>Rule links</span></h3>
        {rules.length > 0 ? (
          <ul>{rules.map((rule) => <li key={rule.text}>{rule.text} <span className={styles.prov} data-prov={rule.provenance}>{rule.provenance === 'observed' ? 'observed: a separate re-run agreed' : 'inferred: event order only'}</span></li>)}</ul>
        ) : (
          <p className="note">No rule links touch this station.</p>
        )}
        <p className="not-cause">A link is not a cause.</p>
      </section>
    </div>
  );
}

export function journeyFacts(journey: Journey): { label: string; value: string }[] {
  const c = journey.counts;
  return [
    { label: 'Capture', value: journey.source.adapter === 't3_code' ? 'T3 Code adapter' : 'Claude Code hooks' },
    { label: 'Sessions', value: String(journey.sessions) },
    { label: 'Prompts', value: String(c.prompts) },
    { label: 'Agent actions', value: String(c.tool_calls) },
    { label: 'Edits', value: String(c.edits) },
    { label: 'Unattributed', value: String(c.unattributed) },
    { label: 'Test runs', value: `${c.tests} (${c.failed} failed, ${c.passed} passed)` },
    { label: 'Separate re-run', value: c.reruns > 0 ? String(c.reruns) : 'none' },
  ];
}
