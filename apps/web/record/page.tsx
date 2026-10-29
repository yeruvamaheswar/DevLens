'use client';
import { useEffect, useState } from 'react';
import { TopBar } from '../ui/topbar';
import { createShareSwitch, type ShareSnapshot, type ShareSwitch } from '../agent/recruiter-feed';
import { createAgentQueue, useAgentQueue, type AgentQueue, type QueueSnapshot } from './agent-queue';
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

const TAB_TITLE: Record<RecorderPhase, string> = {
  idle: 'Record · DevLens',
  arming: 'Choose a window · DevLens',
  recording: '● Recording · DevLens',
  paused: 'Paused · DevLens',
  review: 'Stopped · DevLens',
  uploading: 'Uploading · DevLens',
  uploaded: 'Uploaded · DevLens',
};

// session.ts keeps its own idle sentence. The page names both channels instead of repeating it.
const SESSION_IDLE = 'Nothing is recorded until you click Record one window or Record my desktop (second opt-in).';
const VIDEO_OFF = 'Screen video is off. Nothing is filmed until you click Record one window or Record my desktop.';

// Session messages that report a failure, each with the step that fixes it.
const FIX: Record<string, string> = {
  'Recording did not start.': 'Click Record one window again and pick a window in the browser dialog. If no dialog opens, allow screen recording for this browser in System Settings, Privacy & Security.',
  'The share included a camera track. It was discarded.': 'Start again and share a window, not a camera.',
  'The share did not contain exactly one video track. It was discarded.': 'Start again and share one window only.',
  'Upload failed. The take is still only on this device.': 'Check that the server has DEVLENS_RECORD_ENABLED=1 and can reach Supabase, then click Upload again.',
};

// Wall time since the take started, minus closed pauses. While paused the page stops the clock it passes in.
export function elapsedMs(snap: Pick<RecorderSnapshot, 'wallStartMs' | 'wallEndMs' | 'pauses'>, now: number): number {
  if (snap.wallStartMs === null) return 0;
  const end = snap.wallEndMs ?? now;
  const paused = snap.pauses.reduce((sum, span) => sum + Math.max(0, Math.min(span.resume_ms, end) - span.pause_ms), 0);
  return Math.max(0, end - snap.wallStartMs - paused);
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

type MarkKind = 'live' | 'rec' | 'paused' | 'stopped' | 'done' | 'off' | 'wait' | 'waiting' | 'error';

// One mark set for the page. Shapes follow DESIGN.md: square for questions, disc for live, dashed for unknown.
function Mark({ kind, size = 16 }: { kind: MarkKind; size?: number }) {
  return (
    <svg className={`rmark rmark--${kind}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {kind === 'live' ? <circle cx="8" cy="8" r="5.5" /> : null}
      {kind === 'rec' ? <circle cx="8" cy="8" r="6" /> : null}
      {kind === 'paused' ? <path d="M5 2V14M11 2V14" /> : null}
      {kind === 'stopped' ? <rect x="2.5" y="2.5" width="11" height="11" /> : null}
      {kind === 'done' ? <circle cx="8" cy="8" r="6" /> : null}
      {kind === 'off' ? <circle cx="8" cy="8" r="5" /> : null}
      {kind === 'wait' ? <circle cx="8" cy="8" r="5" /> : null}
      {kind === 'waiting' ? <rect x="2.5" y="2.5" width="11" height="11" /> : null}
      {kind === 'error' ? <path d="M2.5 2.5H13.5V13.5H2.5ZM2.5 13.5L13.5 2.5" /> : null}
    </svg>
  );
}

const PHASE_MARK: Record<RecorderPhase, MarkKind> = {
  idle: 'off', arming: 'wait', recording: 'rec', paused: 'paused', review: 'stopped', uploading: 'wait', uploaded: 'done',
};

function Switch({ label, on, disabled, onToggle }: { label: string; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" disabled={disabled} onClick={onToggle}>
      <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
      <span className="switch-label">{label}</span>
    </button>
  );
}

function agentStatus(snap: QueueSnapshot): { mark: MarkKind; word: string } {
  if (snap.phase === 'unavailable') return { mark: 'error', word: 'Unavailable: set DEVLENS_PROJECT_DIR, then restart DevLens' };
  if (snap.offline) return { mark: 'wait', word: 'Offline, retrying' };
  if (snap.phase === 'loading') return { mark: 'wait', word: 'Checking' };
  if (snap.phase === 'off') return { mark: 'off', word: 'Off' };
  const n = snap.items.length;
  if (n === 0) return { mark: 'live', word: 'Watching this session' };
  return { mark: 'waiting', word: `${n} ${n === 1 ? 'question' : 'questions'} waiting · open the widget` };
}

function logStatus(snap: QueueSnapshot): { mark: MarkKind; word: string; detail: string } {
  const { project, eventCount, lastEventAt } = snap.log;
  if (snap.phase === 'unavailable') return { mark: 'error', word: 'Not set up', detail: 'Set DEVLENS_PROJECT_DIR to your project folder, then restart DevLens.' };
  if (snap.offline) return { mark: 'wait', word: 'Offline, retrying', detail: 'The DevLens server did not answer. Check that it is still running.' };
  if (snap.phase === 'loading') return { mark: 'wait', word: 'Checking', detail: 'Reading the session log.' };
  const name = project ?? 'the project';
  if (eventCount === 0) return { mark: 'wait', word: 'Waiting', detail: `No hook events yet in ${name}. Start Claude Code in that folder.` };
  const last = lastEventAt ? ` · last at ${new Date(lastEventAt).toLocaleTimeString()}` : '';
  return { mark: 'live', word: 'On through the Claude Code hooks', detail: `${name} · ${eventCount} ${eventCount === 1 ? 'event' : 'events'} this session${last}` };
}

function shareStatus(snap: ShareSnapshot): { mark: MarkKind; word: string } {
  if (snap.phase === 'loading') return { mark: 'wait', word: 'Checking' };
  if (snap.phase === 'unavailable') return { mark: 'error', word: 'Unavailable: the recruiter route did not answer. Reload this page to try again.' };
  return snap.sharing ? { mark: 'live', word: 'On · updates go to the recruiter page' } : { mark: 'off', word: 'Off · nothing is sent' };
}

function useShare(share: ShareSwitch): ShareSnapshot {
  const [snap, setSnap] = useState<ShareSnapshot>(() => share.snapshot());
  useEffect(() => {
    const off = share.subscribe(setSnap);
    void share.start();
    return off;
  }, [share]);
  return snap;
}

export function Recorder({ session, agent, share }: { session: RecorderSession; agent?: AgentQueue; share?: ShareSwitch }) {
  const [snap, setSnap] = useState<RecorderSnapshot>(() => session.snapshot());
  useEffect(() => session.subscribe(setSnap), [session]);
  useEffect(() => () => session.dispose(), [session]);
  const [queue] = useState(() => agent ?? createAgentQueue(undefined, { keepPolling: true }));
  const [shareSwitch] = useState(() => share ?? createShareSwitch());
  const agentSnap = useAgentQueue(queue);
  const shareSnap = useShare(shareSwitch);

  // The clock ticks once a second while recording and holds still while paused.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (snap.phase !== 'recording') return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [snap.phase]);
  useEffect(() => { document.title = TAB_TITLE[snap.phase]; }, [snap.phase]);
  useEffect(() => () => { document.title = 'DevLens'; }, []);

  const phase = snap.phase;
  const choosing = phase === 'idle' || phase === 'arming';
  const rolling = phase === 'recording' || phase === 'paused';
  const live = phase !== 'idle';
  const time = clock(elapsedMs(snap, now));
  const message = snap.message === SESSION_IDLE ? VIDEO_OFF : snap.message;
  const fix = FIX[snap.message];
  const agentState = agentStatus(agentSnap);
  const logState = logStatus(agentSnap);
  const shareState = shareStatus(shareSnap);
  const surface = snap.mode === 'desktop' ? 'the desktop' : 'the chosen window';

  return (
    <>
      <TopBar
        place="record"
        take={live ? (
          <span className="rec-take" data-phase={phase}>
            <Mark kind={PHASE_MARK[phase]} size={12} />
            {PHASE_WORD[phase]}
            <b>{time}</b>
          </span>
        ) : undefined}
      />
      <main id="main" className="page record">
        <section className="rec-hero" data-phase={phase} aria-label="Take state">
          <div className="rec-lead">
            <Mark kind={PHASE_MARK[phase]} size={24} />
            <h1 className="rec-word">{PHASE_WORD[phase]}</h1>
            <span className={live ? 'rec-track rec-track--live' : 'rec-track'} aria-hidden="true" />
            <p className="rec-clock"><span className="sr-only">Elapsed </span><time>{time}</time></p>
          </div>
          <p role="status" className="rec-message"><span className="sr-only">{PHASE_WORD[phase]}. </span>{message}</p>
          {fix ? <p className="rec-fix">{fix}</p> : null}
          {rolling ? <p className="rec-keep">Keep this tab open. Closing it stops the take.</p> : null}
        </section>

        <section className="rec-group" aria-labelledby="capture-heading">
          <h2 id="capture-heading" className="rec-h">What DevLens captures</h2>

          <div className="rec-row">
            <h3 className="rec-name">Session log</h3>
            <div className="rec-body">
              <p className="rec-status"><Mark kind={logState.mark} /><b>{logState.word}</b></p>
              <p className="rec-detail">{logState.detail}</p>
              <p className="note">Prompts, tool calls, diffs, test results, and your typed answers. The hooks write this log whether or not screen video is on.</p>
            </div>
          </div>

          <div className="rec-row">
            <h3 className="rec-name">Screen video</h3>
            <div className="rec-body">
              <p className="rec-status">
                <Mark kind={PHASE_MARK[phase]} />
                <b>{choosing ? 'Off until you click' : phase === 'recording' ? `Recording ${surface}` : PHASE_WORD[phase]}</b>
              </p>
              {choosing ? (
                <div className="rec-choose">
                  <div className="rec-choices">
                    <div className="rec-choice">
                      <button type="button" className="btn btn--primary" disabled={phase === 'arming'} onClick={() => { void session.start(); }}>
                        Record one window
                      </button>
                      <p className="rec-risk">Asks for one window. A whole-screen share is discarded.</p>
                    </div>
                    <div className="rec-choice">
                      <button type="button" className="btn" disabled={phase === 'arming'} aria-describedby="desktop-risk" onClick={() => { void session.startDesktop(); }}>
                        Record my desktop
                      </button>
                      <p id="desktop-risk" className="rec-risk">
                        A separate choice. A monitor take can show other windows and notifications. Audio and camera stay off. You can delete the take before upload.
                      </p>
                    </div>
                  </div>
                  <div className="rec-lists">
                    <div>
                      <h4 className="rec-list-h">Captured</h4>
                      <ul>
                        <li>The chosen window</li>
                        <li>The whole desktop, only if you choose Record my desktop</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="rec-list-h">Not captured</h4>
                      <ul>
                        <li>Camera</li>
                        <li>Microphone</li>
                        <li>Other windows, in window mode</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
              {rolling ? (
                <>
                  <p className="rec-oneline">Captured: {surface}. Not captured: camera, microphone.</p>
                  <div className="rec-actions">
                    {phase === 'recording' ? <button type="button" className="btn" onClick={() => session.pause()}>Pause</button> : null}
                    {phase === 'paused' ? <button type="button" className="btn" onClick={() => session.resume()}>Resume</button> : null}
                    <button type="button" className="btn" onClick={() => session.stop()}>Stop</button>
                  </div>
                </>
              ) : null}
              {snap.objectUrl ? (
                <video src={snap.objectUrl} controls preload="metadata" className="rec-video" />
              ) : null}
              {phase === 'review' ? (
                <div className="review-facts">
                  <dl className="rec-facts">
                    <div><dt>Mode</dt><dd>{snap.mode === 'desktop' ? 'Desktop' : 'One window'}</dd></div>
                    <div><dt>Surface the browser reported</dt><dd>{snap.displaySurface ?? 'unknown'}</dd></div>
                    <div><dt>Length</dt><dd>{time}</dd></div>
                  </dl>
                  {snap.mode === 'desktop' && snap.displaySurface === 'monitor' ? (
                    <p className="note">This monitor take is labeled desktop.</p>
                  ) : null}
                  {snap.mode === 'desktop' && snap.displaySurface !== 'monitor' ? (
                    <p className="note">Desktop mode kept this share. The saved surface is {snap.displaySurface}, as the browser reported it.</p>
                  ) : null}
                  <p className="rec-actions">
                    <button type="button" className="btn" onClick={() => session.deleteTake()}>Delete</button>
                    <button type="button" className="btn btn--primary" onClick={() => { void session.upload(); }}>Upload</button>
                  </p>
                </div>
              ) : null}
              {phase === 'uploaded' ? <p><a href="/record">Record another take</a></p> : null}
            </div>
          </div>
        </section>

        <section className="rec-group" aria-labelledby="agent-heading">
          <h2 id="agent-heading" className="rec-h">In the background</h2>

          <div className="rec-row">
            <div className="rec-name">
              <Switch
                label="DevLens Agent"
                on={agentSnap.phase === 'on'}
                disabled={agentSnap.phase === 'unavailable' || agentSnap.phase === 'loading'}
                onToggle={() => { void queue.setEnabled(agentSnap.phase !== 'on'); }}
              />
            </div>
            <div className="rec-body">
              <p className="rec-status" role="status"><Mark kind={agentState.mark} /><b>{agentState.word}</b></p>
              {agentSnap.error && !agentSnap.offline ? <p className="rec-fix">{agentSnap.error}</p> : null}
              <p className="note">It asks short questions about your project in the bottom-right widget. Start the widget with <code>npm run widget</code>. Off by default.</p>
            </div>
          </div>

          <div className="rec-row">
            <div className="rec-name">
              <Switch
                label="Share updates with recruiter"
                on={shareSnap.sharing}
                disabled={shareSnap.phase !== 'ready'}
                onToggle={() => { void shareSwitch.setSharing(!shareSnap.sharing); }}
              />
            </div>
            <div className="rec-body">
              <p className="rec-status"><Mark kind={shareState.mark} /><b>{shareState.word}</b></p>
              {shareSnap.error ? <p className="rec-fix">{shareSnap.error}</p> : null}
              <p className="note">
                Facts from the session log (prompts, files changed, tests, answers) go to the recruiter page. No code, no score.{' '}
                <a href="/recruiter">Open the recruiter page</a>
              </p>
            </div>
          </div>
        </section>

        <p className="rec-limits">DevLens shows no score, rank, or verdict. The reviewer decides.</p>
      </main>
    </>
  );
}

export default function RecordPage() {
  const [session] = useState(() => createRecorderSession(browserDeps()));
  return <Recorder session={session} />;
}
