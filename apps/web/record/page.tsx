'use client';
import { useEffect, useState } from 'react';
import { TopBar } from '../ui/topbar';
import { AgentPanel } from './agent-queue';
import { browserDeps } from './browser';
import { createRecorderSession, type RecorderPhase, type RecorderSession, type RecorderSnapshot } from './session';

// Recording state is a word plus a mark shape, never colour alone.
const PHASE_WORD: Record<RecorderPhase, string> = {
  idle: 'Not recording',
  arming: 'Waiting for your choice',
  recording: 'Recording',
  paused: 'Paused',
  review: 'Stopped, review the take',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
};

const OPT_IN = 'Nothing is recorded until you click Record one window or Record my desktop (second opt-in).';

// The state as a short line: stopped ends in an open terminus, recording runs to a live station.
function StateLine({ phase }: { phase: RecorderPhase }) {
  const live = phase === 'recording' || phase === 'paused' || phase === 'review' || phase === 'uploading' || phase === 'uploaded';
  return (
    <svg className="rec-line" width="64" height="20" viewBox="0 0 64 20" aria-hidden="true">
      <path className={live ? 'rec-run rec-run--live' : 'rec-run'} d="M2 10H44" />
      {phase === 'recording' ? <circle className="rec-live" cx="52" cy="10" r="7" /> : null}
      {phase === 'paused' ? <path className="rec-pause" d="M48 3V17M56 3V17" /> : null}
      {phase === 'review' || phase === 'uploading' ? <rect className="rec-end" x="45" y="3" width="14" height="14" /> : null}
      {phase === 'uploaded' ? <circle className="rec-done" cx="52" cy="10" r="7" /> : null}
      {phase === 'idle' || phase === 'arming' ? <circle className="rec-stop" cx="52" cy="10" r="6" /> : null}
    </svg>
  );
}

export function Recorder({ session }: { session: RecorderSession }) {
  const [snap, setSnap] = useState<RecorderSnapshot>(() => session.snapshot());
  useEffect(() => session.subscribe(setSnap), [session]);
  useEffect(() => () => session.dispose(), [session]);
  return (
    <>
      <TopBar place="record" />
      <main id="main" className="page record">
        <h1>Record</h1>
        <section className="rec-panel" aria-label="Recorder">
          <p className="rec-state" data-phase={snap.phase}>
            <StateLine phase={snap.phase} />
            {PHASE_WORD[snap.phase]}
          </p>
          <p role="status" className="rec-message">{snap.message}</p>
          {snap.message !== OPT_IN && (snap.phase === 'idle' || snap.phase === 'arming') ? <p className="rec-optin">{OPT_IN}</p> : null}
          <div className="rec-actions">
            {snap.phase === 'idle' || snap.phase === 'arming' ? (
              <>
                <button type="button" className="btn btn--primary" disabled={snap.phase === 'arming'} onClick={() => { void session.start(); }}>
                  Record one window
                </button>
                <button type="button" className="btn" disabled={snap.phase === 'arming'} aria-describedby="desktop-consent" onClick={() => { void session.startDesktop(); }}>
                  Record my desktop (second opt-in)
                </button>
              </>
            ) : null}
            {snap.phase === 'recording' ? <button type="button" className="btn" onClick={() => session.pause()}>Pause</button> : null}
            {snap.phase === 'paused' ? <button type="button" className="btn" onClick={() => session.resume()}>Resume</button> : null}
            {snap.phase === 'recording' || snap.phase === 'paused' ? (
              <button type="button" className="btn" onClick={() => session.stop()}>Stop</button>
            ) : null}
          </div>
          {snap.phase === 'idle' ? <p className="note">Read what is <a href="#consent">captured and not captured</a> before you start.</p> : null}
          {snap.objectUrl ? (
            <video src={snap.objectUrl} controls preload="metadata" className="rec-video" />
          ) : null}
          {snap.phase === 'review' ? (
            <div className="review-facts">
              <p>Take mode: {snap.mode}.</p>
              <p>Captured surface: {snap.displaySurface}.</p>
              {snap.mode === 'desktop' && snap.displaySurface === 'monitor' ? (
                <p>This monitor take is labeled desktop.</p>
              ) : null}
              {snap.mode === 'desktop' && snap.displaySurface !== 'monitor' ? (
                <p>
                  Desktop mode kept this share. The browser reported {snap.displaySurface}, so the saved display_surface is that captured surface.
                </p>
              ) : null}
              <p className="rec-actions">
                <button type="button" className="btn" onClick={() => session.deleteTake()}>Delete</button>
                <button type="button" className="btn btn--primary" onClick={() => { void session.upload(); }}>Upload</button>
              </p>
            </div>
          ) : null}
        </section>
        <AgentPanel />
        <section id="consent" aria-label="Consent" className="consent">
          <div>
            <h2>Captured</h2>
            <ul>
              <li>The chosen window</li>
              <li>Prompts, tool calls, diffs, and output</li>
              <li>Test results</li>
              <li>The typed answer</li>
            </ul>
          </div>
          <div>
            <h2>Not captured</h2>
            <ul>
              <li>Camera</li>
              <li>Microphone</li>
              <li>The whole desktop, unless you choose Record my desktop (second opt-in)</li>
              <li>A score</li>
            </ul>
          </div>
        </section>
        <section id="desktop-consent" aria-label="Desktop consent" className="desktop-consent">
          <h2>Desktop opt-in</h2>
          <p>
            Record my desktop is a separate choice. A monitor take can show other windows and notifications.
            Audio and camera stay off. You can delete the take before upload.
          </p>
        </section>
      </main>
    </>
  );
}

export default function RecordPage() {
  const [session] = useState(() => createRecorderSession(browserDeps()));
  return <Recorder session={session} />;
}
