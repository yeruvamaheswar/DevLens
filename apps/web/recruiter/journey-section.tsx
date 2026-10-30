'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JourneySourceRow, JourneyResponse } from '../journey/sources';
import { journeyLayout } from '../journey/layout';
import { takeLabels } from '../journey/takes';
import { ChainStrip, Chip, EvidencePanel, JourneyLine, Legend, clock, journeyFacts } from '../journey/journey';
import styles from './page.module.css';

function initialSource(): string {
  if (typeof location === 'undefined') return 'golden';
  return new URLSearchParams(location.search).get('source') ?? 'golden';
}

export function JourneySection() {
  const [sources, setSources] = useState<JourneySourceRow[]>([]);
  const [key, setKey] = useState<string>('golden');
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [chainOnly, setChainOnly] = useState(false);
  const [seekNote, setSeekNote] = useState('');
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setKey(initialSource());
    fetch('/api/journey', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ sources: JourneySourceRow[] }>)
      .then((body) => setSources(body.sources))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    // Only the latest source may fill the page: a slow earlier answer is dropped.
    const controller = new AbortController();
    setData(null);
    setError(null);
    fetch(`/api/journey?source=${encodeURIComponent(key)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<JourneyResponse>;
      })
      .then((body) => {
        setData(body);
        const failure = body.journey.chain.find((step) => step.key === 'failure')?.station;
        setSelected(failure ?? body.journey.stations[0]?.id ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('This journey could not be loaded. Check that the capture folder exists, then reload.');
      });
    return () => controller.abort();
  }, [key]);

  // A local T3 capture (`t3:`) is refetched every 5 s, live or not: `t3 watch` may start after the page opens, and one
  // stale "not live" answer must not stop the updates (review finding 1). Keep the data and the chosen station on a failed poll.
  const live = data?.journey.source.live === true;
  const local = key.startsWith('t3:');
  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetch(`/api/journey?source=${encodeURIComponent(key)}`, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json() as Promise<JourneyResponse>;
        })
        .then((body) => {
          setData(body);
          setSelected((current) => (current && body.journey.stations.some((item) => item.id === current) ? current : body.journey.stations[0]?.id ?? null));
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [local, key]);

  const layout = useMemo(() => {
    if (!data) return null;
    const rerunOf = (id: string) => {
      const event = data.events.find((item) => item.id === id);
      return typeof event?.payload.rerun_of === 'string' ? event.payload.rerun_of : null;
    };
    return journeyLayout(data.journey.stations, { rerunOf });
  }, [data]);

  function pick(next: string) {
    setKey(next);
    const url = new URL(location.href);
    url.searchParams.set('source', next);
    history.replaceState(null, '', url);
  }

  function seek(ms: number) {
    const player = video.current;
    if (!player) return;
    const apply = () => {
      player.currentTime = ms / 1000;
      setSeekNote(`Recording moved to ${clock(ms)}.`);
    };
    if (player.readyState >= 1) apply();
    else player.addEventListener('loadedmetadata', apply, { once: true });
  }

  function select(id: string) {
    setSelected(id);
    const station = data?.journey.stations.find((item) => item.id === id);
    if (station?.offset_ms != null && data?.journey.source.media) seek(station.offset_ms);
    else setSeekNote(station?.branch ? 'The separate re-run has no footage.' : 'This station has no recording time.');
  }

  function selectEvent(eventId: string) {
    const station = data?.journey.stations.find((item) => item.event_ids.includes(eventId) || item.context_ids.includes(eventId));
    if (station) select(station.id);
  }

  const journey = data?.journey ?? null;
  const station = journey?.stations.find((item) => item.id === selected) ?? null;
  const shortId = (id: string) => (id.length > 34 ? `${id.slice(0, 14)}…${id.slice(-16)}` : id);

  return (
    <section className={styles.journey} aria-labelledby="journey-title">
      <div className={styles.journeyHead}>
        <h2 id="journey-title">Development journey</h2>
        <div className={styles.sources} role="group" aria-label="Session to review">
          {(sources.length > 0 ? sources : [{ key: 'golden', label: 'Claude Code golden take', status: 'verified' as const, adapter: 'claude_code_hook' as const }]).map((row) => (
            <button key={row.key} type="button" aria-pressed={row.key === key} className={styles.source} data-active={row.key === key ? 'true' : undefined} onClick={() => pick(row.key)}>
              <span className={styles.sourceStatus} data-status={row.status}>{row.status === 'verified' ? 'Verified' : 'Experimental'}</span>
              <span>{row.label}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? <p className={styles.state} role="alert">{error}</p> : null}
      {!journey && !error ? <p className={styles.state}>Loading the journey…</p> : null}

      {journey && layout ? (
        <>
          <p className={styles.provenance}>
            <Chip kind={journey.source.status === 'verified' ? 'observed' : 'unknown'} text={journey.source.status === 'verified' ? 'Verified capture' : 'Experimental capture'} />{' '}
            {live ? <span className={styles.liveChip} role="status">Live</span> : null} {journey.source.provenance_note}
          </p>
          {journey.source.take ? (
            <ul className={styles.takeLabels} aria-label="About this take">
              {takeLabels(journey.source, data?.events ?? []).map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
          <dl className={styles.facts}>
            {journeyFacts(journey).map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
            <div className={styles.factWide}>
              <dt>Provider and model</dt>
              <dd>{journey.agents.length > 0 ? journey.agents.map((agent) => `${agent.label}${agent.runs.length ? ` (runs ${agent.runs.length > 6 ? `${agent.runs[0]}–${agent.runs[agent.runs.length - 1]}` : agent.runs.join(', ')})` : ''}`).join('; ') : 'Not recorded by this capture. Claude Code hooks do not report the model per event.'}</dd>
            </div>
          </dl>

          {journey.stations.length <= 1 ? (
            <p className={styles.state}>No linked events in this session yet. Nothing is drawn until real events exist.</p>
          ) : (
            <>
              <div className={styles.lineWrap}>
                <JourneyLine layout={layout} selected={selected} onSelect={select} chainOnly={chainOnly} />
              </div>
              <div className={styles.lineFoot}>
                <Legend />
                <label className={styles.toggle}>
                  <input type="checkbox" checked={chainOnly} onChange={(event) => setChainOnly(event.target.checked)} /> Show only the failure-to-fix chain
                </label>
              </div>
              <p className={styles.lineNote}>The line is time order of recorded events. Italic titles are derived groups or labels; the evidence panel says why. A station is not a cause.</p>
              <ChainStrip chain={journey.chain} selected={selected} onSelect={select} />
            </>
          )}

          <div className={styles.lower}>
            {station ? <EvidencePanel station={station} events={data!.events} edges={data!.edges} canSeek={journey.source.media != null} onSeek={seek} /> : <p className={styles.state}>Pick a station to see its evidence.</p>}
            <aside className={styles.player} aria-label="Recording">
              {journey.source.media ? (
                <>
                  <div className={styles.videoFrame}>
                    <span className={styles.videoTag} aria-hidden="true">Recording · audio off · camera off</span>
                    <video ref={video} src={journey.source.media.url} controls preload="metadata" playsInline className={styles.video} aria-label={journey.source.media.label} />
                  </div>
                  <p className="note" role="status">{seekNote || journey.source.media.label}</p>
                </>
              ) : (
                <p className={styles.state}>No recording is attached to this session.</p>
              )}
              <p className="note">Text redaction applies to the event log only. It does not remove secrets that appear in video frames.</p>
            </aside>
          </div>

          <section className={styles.questions} aria-labelledby="jq-title">
            <h3 id="jq-title">Interview questions</h3>
            <p className="note">Each question comes from a fixed rule over the recorded events and cites them. No model writes them. They are prompts for a conversation, not a test.</p>
            <ol>
              {journey.questions.map((question) => (
                <li key={question.id}>
                  <p className={styles.qText}>{question.text}</p>
                  {question.answer ? (
                    <p className={styles.qAnswer}><Chip kind="developer" /> {question.answer.text} <span className="note">{question.answer.label}</span></p>
                  ) : null}
                  <p className={styles.qCites}>
                    Rule {question.rule_id}. Events:{' '}
                    {question.event_ids.map((id) => (
                      <button key={id} type="button" className="link mono" title={id} onClick={() => selectEvent(id)}>{shortId(id)}</button>
                    ))}
                  </p>
                </li>
              ))}
            </ol>
            {journey.questions.length === 0 ? <p className={styles.state}>No question rule matched this session.</p> : null}
          </section>

          <section className={styles.limits} aria-label="Unknowns and limits">
            <div>
              <h3>Unknowns and attribution limits</h3>
              <ul>{journey.unknowns.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
            <div>
              <h3>Not captured</h3>
              <ul>{journey.source.not_captured.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
