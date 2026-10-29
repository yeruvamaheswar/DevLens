'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecruiterEntry } from '../../../packages/recruiter/src/build';
import type { RecruiterState } from '../../../packages/recruiter/src/api';
import { TopBar } from '../ui/topbar';
import styles from './page.module.css';

const POLL_MS = 5_000;
const MAX_CITES_SHOWN = 6;

// Kind is a word plus a shape: an update is a filled station, a status on request is an open square.
const KIND_WORD: Record<RecruiterEntry['kind'], string> = { update: 'Update', status: 'Status on request' };

function KindMark({ kind }: { kind: RecruiterEntry['kind'] }) {
  return (
    <svg className={styles.mark} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {kind === 'update' ? <circle cx="7" cy="7" r="5.5" className={styles.markFilled} /> : <rect x="1.5" y="1.5" width="11" height="11" className={styles.markOpen} />}
    </svg>
  );
}

function clock(ts: string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Entry({ entry }: { entry: RecruiterEntry }) {
  return (
    <li className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.kind}>
          <KindMark kind={entry.kind} />
          {KIND_WORD[entry.kind]}
        </span>
        <time className={styles.time} dateTime={entry.ts} title={entry.ts}>{clock(entry.ts)}</time>
      </div>
      {entry.lines.length === 0 ? (
        <p className={styles.none}>No session events yet.</p>
      ) : (
        <ul className={styles.lines}>
          {entry.lines.map((line, index) => (
            <li key={index} className={line.prompt ? `${styles.line} ${styles.prompt}` : styles.line}>
              {line.prompt ? (
                <>
                  <span className={styles.promptLabel}>Developer prompt</span>
                  <blockquote className={styles.promptText}>{line.text}</blockquote>
                </>
              ) : (
                <span className={styles.text}>{line.text}</span>
              )}
              <span className={styles.cites}>
                <span className="sr-only">Events: </span>
                {line.cites.slice(0, MAX_CITES_SHOWN).map((cite) => <code key={cite} className={styles.cite}>{cite}</code>)}
                {line.cites.length > MAX_CITES_SHOWN ? <span className={styles.more}>and {line.cites.length - MAX_CITES_SHOWN} more</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function RecruiterPage() {
  const [state, setState] = useState<RecruiterState | null>(null);
  const [pollError, setPollError] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch('/api/recruiter', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      setState((await response.json()) as RecruiterState);
      setPollError(false);
    } catch {
      setPollError(true);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function requestStatus() {
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch('/api/recruiter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'request_status' }) });
      const body = (await response.json()) as { entry?: RecruiterEntry; error?: string };
      if (response.ok && body.entry) setNotice(`Status sent ${clock(body.entry.ts)}`);
      else if (body.error === 'sharing_off') setNotice('The developer has not turned on sharing.');
      else setNotice('Status not sent. Try again.');
    } catch {
      setNotice('Status not sent. Try again.');
    } finally {
      setSending(false);
      void refresh();
    }
  }

  const sharing = state?.available === true && state.sharing;

  return (
    <>
      <TopBar place="home" />
      <main id="main" className="page">
        <section className={`band ${styles.head}`}>
          <h1 className={styles.title}>Recruiter view</h1>
          <p className={styles.project}>{state?.project ?? ' '}</p>
          <p className={styles.statement}>Facts from the session log. No score, rank, or verdict.</p>
          <div className={styles.actions}>
            <button type="button" className="btn btn--primary" onClick={() => void requestStatus()} disabled={!sharing || sending}>
              {sending ? 'Requesting…' : 'Request status'}
            </button>
            <p className={styles.notice} role="status" aria-live="polite">{notice ?? ''}</p>
          </div>
        </section>

        <section className={styles.feed} aria-labelledby="feed-title">
          <h2 id="feed-title" className="sr-only">Updates, newest first</h2>
          {pollError ? <p className={styles.state} role="alert">Could not reach the session log. Trying again every 5 seconds.</p> : null}
          {state === null ? (
            pollError ? null : <p className={styles.state}>Loading…</p>
          ) : !state.available ? (
            <p className={styles.state}>The recruiter view is not set up on this server.</p>
          ) : !state.sharing ? (
            <p className={styles.state}>The developer has not turned on sharing.</p>
          ) : state.updates.length === 0 ? (
            <p className={styles.state}>No updates yet. Updates arrive when the developer shares them.</p>
          ) : (
            <ol className={styles.list}>
              {state.updates.map((entry) => <Entry key={entry.id} entry={entry} />)}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}
