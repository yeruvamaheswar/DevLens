'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClaimEvent, ReplayView } from './view';

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

function EventBlock({ event, heading }: { event: ClaimEvent; heading: string }) {
  return (
    <article>
      <h3>{heading}</h3>
      <p>Origin: {event.origin}. Event id: {event.id}.</p>
      <p>{event.summary}</p>
      {event.file ? <p>File: {event.file}.</p> : null}
      <p>{event.offset_ms == null ? 'No recording offset.' : `Recorded at ${seconds(event.offset_ms)} seconds.`}</p>
      {event.output ? <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f4f4', padding: 12, overflow: 'auto', maxHeight: 280 }}>{event.output}</pre> : null}
    </article>
  );
}

export default function ReplayPage() {
  const [data, setData] = useState<ReplayView | null>(null);
  const [error, setError] = useState('');
  const [seekNote, setSeekNote] = useState('The recording is ready. The failed-test button moves it.');
  const [frameNote, setFrameNote] = useState('Waiting for the recording frame.');
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
      })
      .catch(() => setError('Replay unavailable. Restart the local demo.'));
  }, []);

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
    player.scrollIntoView({ block: 'center' });
  }

  if (!data) return <main>{error || 'Loading golden take…'}</main>;

  const claim = data.claim;
  return (
    <main style={{ maxWidth: 960, margin: '48px auto', padding: 24, fontFamily: 'system-ui', lineHeight: 1.6 }}>
      <h1>DevLens Replay</h1>
      <p><strong>{data.label}</strong> · {data.mode}</p>
      <p>{data.warning}</p>
      <p>This page plays a finished take. It does not record.</p>
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
        style={{ width: '100%', height: 'auto', aspectRatio: '2462 / 1582', objectFit: 'contain', background: '#111', display: 'block' }}
        onLoadedMetadata={() => { if (video.current) setFrameNote(frameText(video.current)); }}
        onSeeked={() => {
          const player = video.current;
          if (!player) return;
          setSeekNote(`Player time is ${player.currentTime.toFixed(1)} seconds.`);
          setFrameNote(frameText(player));
        }}
        onError={() => setError('Media unavailable. Reload to refresh the short-lived URL.')}
      />
      <p>{frameNote}</p>
      <p>Claude Code collapses tool output on screen. At a seek point the failing or passing output may not be visible. The log text below is the evidence.</p>
      <p role="status">{error || seekNote}</p>
      <h2>Failure to pass</h2>
      <p>
        <button type="button" onClick={() => seekTo(claim.failure.offset_ms)} style={{ padding: 16, cursor: 'pointer' }}>
          Open the first failed test at {seconds(claim.failure.offset_ms)} seconds
        </button>
      </p>
      <p>
        <button type="button" onClick={() => seekTo(claim.pass.offset_ms)} style={{ padding: 16, cursor: 'pointer' }}>
          Seek to the passing test at {seconds(claim.pass.offset_ms)} seconds
        </button>
      </p>
      <section aria-label="Cited evidence">
        <h2>Cited evidence</h2>
        <p>{claim.origins.model}</p>
        <p>{claim.origins.rule}</p>
        <p>{claim.origins.worker}</p>
        <EventBlock event={claim.failure} heading="Failed test" />
        <article>
          <h3>Question and answer</h3>
          <p>{claim.answer_note}</p>
        </article>
        {[...claim.edits, ...claim.between, claim.pass]
          .sort((a, b) => (a.offset_ms ?? Number.MAX_SAFE_INTEGER) - (b.offset_ms ?? Number.MAX_SAFE_INTEGER))
          .map((event) => (
            <EventBlock
              key={event.id}
              event={event}
              heading={event.type === 'file_edit' ? 'Later edit' : event.status === 'passed' ? 'Passing test' : 'Later failed test'}
            />
          ))}
        {claim.diffs.map((diff) => (
          <figure key={diff.name}>
            <figcaption>
              {diff.name}. commit diff, from git, not from the hook log. Paired with these hooked edits by session order, which is an inference: {diff.event_ids.join(', ')}.
            </figcaption>
            {diff.hook_redacted ? <p>The hook log stored an edit line as [REDACTED]. That marker is not a secret.</p> : null}
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f4f4', padding: 12, overflow: 'auto', maxHeight: 280 }}>{diff.patch}</pre>
          </figure>
        ))}
        <section aria-label="Worker re-run" style={{ border: '1px solid #222', padding: 16, marginTop: 24 }}>
          <h3>Worker re-run</h3>
          <p>Separate from the session test line.</p>
          <EventBlock event={claim.rerun} heading="Sandbox result" />
        </section>
        <h3>Rules</h3>
        <p>A rule edge comes from a fixed rule applied to recorded events. Observed means a separate sandbox re-run gave the same result. Inferred means no re-run confirmed it, so the link rests on event order. Neither is a cause.</p>
        <ul>
          {claim.rules.map((rule) => (
            <li key={rule.id}>
              {rule.rel}. Rule {rule.derived_by}. {rule.provenance}. From {rule.src} to {rule.dst}. Evidence: {rule.evidence_event_ids.join(', ')}.
            </li>
          ))}
        </ul>
      </section>
      <h2>Questions</h2>
      <ol>
        {data.questions.map((question) => (
          <li key={question.id}>
            <p>{question.text}</p>
            {data.answers_present ? (
              <>
                {question.answer ? <p>{question.answer.label}</p> : null}
                <blockquote style={{ whiteSpace: 'pre-wrap' }}>{question.answer ? question.answer.text : 'Not answered.'}</blockquote>
              </>
            ) : null}
            <p>Origin: rule derived, {question.rule_id}. No model call.</p>
            <ul>
              {question.event_ids.map((id) => {
                const event = data.events.find((item) => item.id === id);
                return <li key={id}>{id}{event ? ` · ${event.type} · ${event.source}` : ''}</li>;
              })}
            </ul>
          </li>
        ))}
      </ol>
      {data.usage ? (
        <section aria-label="Coding-agent usage (context)">
          <h2>Coding-agent usage (context)</h2>
          <table>
            <thead>
              <tr><th>Requests</th><th>Model</th><th>Input tokens</th><th>Output tokens</th><th>Cache write 1h</th><th>Cache write 5m</th><th>Cache read</th><th>List-price equivalent (USD)</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>{data.usage.requests}</td>
                <td>{data.usage.models.join(', ')}</td>
                <td>{data.usage.input_tokens.toLocaleString('en-US')}</td>
                <td>{data.usage.output_tokens.toLocaleString('en-US')}</td>
                <td>{data.usage.cache_write_1h.toLocaleString('en-US')}</td>
                <td>{data.usage.cache_write_5m.toLocaleString('en-US')}</td>
                <td>{data.usage.cache_read.toLocaleString('en-US')}</td>
                <td>${data.usage.list_price_usd.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
          <p>Billing route: {data.usage.billing_route_label}. Price table: {data.usage.price_table} ({data.usage.price_table_date}).</p>
          <p>{data.usage.note}</p>
        </section>
      ) : null}
      <h2>Unknowns</h2>
      <ul>{data.unknowns.map((line) => <li key={line}>{line}</li>)}</ul>
      <h2>Not captured</h2>
      <p>This take did not capture:</p>
      <ul>{data.not_captured.map((item) => <li key={item}>{item}</li>)}</ul>
    </main>
  );
}
