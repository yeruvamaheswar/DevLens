'use client';
import { useEffect, useState } from 'react';
import { browserDeps } from './browser';
import { createRecorderSession, type RecorderSession, type RecorderSnapshot } from './session';

const buttonStyle = { padding: '12px 16px', cursor: 'pointer', marginRight: 8 };

export function Recorder({ session }: { session: RecorderSession }) {
  const [snap, setSnap] = useState<RecorderSnapshot>(() => session.snapshot());
  useEffect(() => session.subscribe(setSnap), [session]);
  useEffect(() => () => session.dispose(), [session]);
  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: 24, fontFamily: 'system-ui', lineHeight: 1.5 }}>
      <h1>Record</h1>
      <p>Nothing is recorded until you click Start recording. Choose Record one window, or Record my desktop (second opt-in).</p>
      <section aria-label="Consent">
        <h2>Captured</h2>
        <ul>
          <li>The chosen window</li>
          <li>Prompts, tool calls, diffs, and output</li>
          <li>Test results</li>
          <li>The typed answer</li>
        </ul>
        <h2>Not captured</h2>
        <ul>
          <li>Camera</li>
          <li>Microphone</li>
          <li>The whole desktop</li>
          <li>A score</li>
        </ul>
      </section>
      <section id="desktop-consent" aria-label="Desktop consent">
        <h2>Desktop opt-in</h2>
        <p>
          Record my desktop is a separate choice. A monitor take can show other windows and notifications.
          Audio and camera stay off. You can delete the take before upload.
        </p>
      </section>
      <p role="status">{snap.message}</p>
      {snap.phase === 'idle' || snap.phase === 'arming' ? (
        <>
          <button type="button" style={buttonStyle} disabled={snap.phase === 'arming'} onClick={() => { void session.start(); }}>
            Record one window
          </button>
          <button type="button" style={buttonStyle} disabled={snap.phase === 'arming'} aria-describedby="desktop-consent" onClick={() => { void session.startDesktop(); }}>
            Record my desktop (second opt-in)
          </button>
        </>
      ) : null}
      {snap.phase === 'recording' ? <button type="button" style={buttonStyle} onClick={() => session.pause()}>Pause</button> : null}
      {snap.phase === 'paused' ? <button type="button" style={buttonStyle} onClick={() => session.resume()}>Resume</button> : null}
      {snap.phase === 'recording' || snap.phase === 'paused' ? (
        <button type="button" style={buttonStyle} onClick={() => session.stop()}>Stop</button>
      ) : null}
      {snap.objectUrl ? (
        <video src={snap.objectUrl} controls preload="metadata" style={{ display: 'block', width: '100%', margin: '16px 0', background: '#111' }} />
      ) : null}
      {snap.phase === 'review' ? (
        <>
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
          <p>
            <button type="button" style={buttonStyle} onClick={() => session.deleteTake()}>Delete</button>
            <button type="button" style={buttonStyle} onClick={() => { void session.upload(); }}>Upload</button>
          </p>
        </>
      ) : null}
    </main>
  );
}

export default function RecordPage() {
  const [session] = useState(() => createRecorderSession(browserDeps()));
  return <Recorder session={session} />;
}
