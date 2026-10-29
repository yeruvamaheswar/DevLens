import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createShareSwitch } from '../agent/recruiter-feed';

describe('record page source', () => {
  it('shows consent and starts capture only from a Record click', async () => {
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(page).toContain('Nothing is filmed until you click Record one window or Record my desktop.');
    expect(page).toContain('The chosen window');
    expect(page).toContain('Prompts, tool calls, diffs, test results, and your typed answers.');
    expect(page).toContain('Camera');
    expect(page).toContain('Microphone');
    expect(page).toContain('The whole desktop, only if you choose Record my desktop');
    expect(page).toContain('DevLens shows no score, rank, or verdict.');
    expect(page).toContain('Record one window');
    expect(page).not.toContain('click Start recording');
    expect(page).not.toContain('(second opt-in)</');
    expect(page).toContain('onClick={() => { void session.start(); }}');
    expect(page).toContain('onClick={() => session.deleteTake()}');
    expect(page).toContain('onClick={() => { void session.upload(); }}');
    expect(page).not.toContain('getDisplayMedia');
    expect(page).not.toContain('getUserMedia');
    expect(page).not.toContain('SUPABASE_SECRET_KEY');
    expect(page).not.toMatch(/useEffect\([^)]*session\.start/);
  });

  it('starts desktop only from its own click and puts the desktop risk under its button', async () => {
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(page).toContain('Record my desktop');
    expect(page).toContain('onClick={() => { void session.start(); }}');
    expect(page).toContain('onClick={() => { void session.startDesktop(); }}');
    expect(page).toContain('A monitor take can show other windows and notifications.');
    expect(page).toContain('Audio and camera stay off.');
    expect(page).toContain('You can delete the take before upload.');
    expect(page).toContain('This monitor take is labeled desktop.');
    expect(page).toContain('The saved surface is {snap.displaySurface}');
    expect(page).not.toContain('getUserMedia');
    expect(page).not.toContain('audio: true');
    expect(page).not.toContain('onKeyDown');
    expect(page).not.toContain('keydown');
    expect(page).not.toContain('keystroke');
    const windowClick = page.indexOf('onClick={() => { void session.start(); }}');
    const desktopClick = page.indexOf('onClick={() => { void session.startDesktop(); }}');
    expect(windowClick).toBeGreaterThan(-1);
    expect(desktopClick).toBeGreaterThan(windowClick);
    // The risk text sits right after the desktop button, not in a section far below.
    const risk = page.indexOf('id="desktop-risk"');
    expect(risk).toBeGreaterThan(desktopClick);
    expect(risk - desktopClick).toBeLessThan(400);
  });

  it('never asks the recruiter route for status', async () => {
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(page).not.toContain('request_status');
  });
});

// tsx (not vitest) loads page.tsx, because tsconfig sets jsx to preserve and vitest cannot parse JSX.
type Case = { name: string; snap: Record<string, unknown>; agent?: Record<string, unknown>; share?: Record<string, unknown> };
const IDLE = { phase: 'idle', message: 'Nothing is recorded until you click Record one window or Record my desktop (second opt-in).', objectUrl: null, wallStartMs: null, wallEndMs: null, pauses: [], mode: 'window', displaySurface: null };
const LOG = { project: 'shop-api', eventCount: 42, lastEventAt: null };
const AGENT_OFF = { phase: 'off', items: [], popupId: null, error: null, offline: false, log: LOG };
const SHARE_OFF = { phase: 'ready', sharing: false, error: null };
const q = (id: string) => ({ id, text: `Question ${id}?`, cites: [], reason: 'r', asked_at: 't', answer: null });

function render(cases: Case[]): Record<string, string> {
  const code = `import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.React = React;
const { Recorder } = await import(process.argv[1]);
const cases = JSON.parse(process.argv[2]);
const fake = (snap) => ({ snapshot: () => snap, subscribe: () => () => {}, start: async () => {}, stop: () => {}, setEnabled: async () => {}, setSharing: async () => {}, answer: async () => {}, skip: async () => {}, dismissPopup: () => {} });
const out = {};
for (const c of cases) {
  const session = { snapshot: () => c.snap, subscribe: () => () => {}, dispose: () => {} };
  out[c.name] = renderToStaticMarkup(React.createElement(Recorder, { session, agent: fake(c.agent), share: fake(c.share) }));
}
process.stdout.write(JSON.stringify(out));
`;
  const filled = cases.map((c) => ({ agent: AGENT_OFF, share: SHARE_OFF, ...c }));
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, path.resolve('apps/web/record/page.tsx'), JSON.stringify(filled)], { encoding: 'utf8', cwd: path.resolve('.') });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, string>;
}

function clockOf(snap: object, now: number): { ms: number; text: string } {
  const code = `const { elapsedMs, clock } = await import(process.argv[1]);
const ms = elapsedMs(JSON.parse(process.argv[2]), Number(process.argv[3]));
process.stdout.write(JSON.stringify({ ms, text: clock(ms) }));`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, path.resolve('apps/web/record/page.tsx'), JSON.stringify(snap), String(now)], { encoding: 'utf8', cwd: path.resolve('.') });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { ms: number; text: string };
}

const between = (html: string, start: string, end: string) => {
  const a = html.indexOf(start);
  expect(a, `missing ${start}`).toBeGreaterThan(-1);
  return html.slice(a, html.indexOf(end, a + start.length));
};

describe('/record render (EVAL-27, EVAL-35)', () => {
  const html = render([
    { name: 'idle', snap: IDLE },
    { name: 'on', snap: IDLE, agent: { ...AGENT_OFF, phase: 'on', items: [q('a'), q('b')], popupId: 'b' } },
    { name: 'watching', snap: IDLE, agent: { ...AGENT_OFF, phase: 'on' } },
    { name: 'offline', snap: IDLE, agent: { ...AGENT_OFF, phase: 'on', offline: true, error: 'x' } },
    { name: 'unavailable', snap: IDLE, agent: { ...AGENT_OFF, phase: 'unavailable', log: { project: null, eventCount: 0, lastEventAt: null } }, share: { phase: 'unavailable', sharing: false, error: null } },
    { name: 'sharing', snap: IDLE, share: { phase: 'ready', sharing: true, error: null } },
    { name: 'recording', snap: { ...IDLE, phase: 'recording', message: 'Recording the chosen window. Audio and camera stay off.', wallStartMs: Date.now() - 65_000, displaySurface: 'window' } },
    { name: 'review', snap: { ...IDLE, phase: 'review', message: 'Play the take or delete it. Upload is a separate step.', wallStartMs: 1000, wallEndMs: 66_000, mode: 'desktop', displaySurface: 'monitor', objectUrl: 'blob:x' } },
    { name: 'failed', snap: { ...IDLE, phase: 'review', message: 'Upload failed. The take is still only on this device.', wallStartMs: 1000, wallEndMs: 2000, displaySurface: 'window', objectUrl: 'blob:x' } },
    { name: 'uploaded', snap: { ...IDLE, phase: 'uploaded', message: 'Uploaded to private storage. Replay can sign this object later.', wallStartMs: 1000, wallEndMs: 2000, displaySurface: 'window' } },
  ]);

  it('leads with the state: a 26px state word, an elapsed clock, and the phase word in the live region', () => {
    const hero = between(html.idle, '<section class="rec-hero"', '</section>');
    expect(hero).toContain('<h1 class="rec-word">Not recording</h1>');
    expect(hero).toContain('<time>00:00</time>');
    expect(hero).toMatch(/role="status"[^>]*><span class="sr-only">Not recording\. <\/span>Screen video is off\./);
    expect(html.idle).not.toContain('Keep this tab open');
    expect(html.idle).not.toContain('class="take"');
    expect(html.recording).toContain('Keep this tab open. Closing it stops the take.');
    expect(html.recording).toMatch(/<div class="take"><span class="rec-take" data-phase="recording">.*Recording<b>01:0\d<\/b><\/span><\/div>/);
    expect(html.review).toContain('<time>01:05</time>');
  });

  it('names both capture channels with the project and a live event count', () => {
    expect(html.idle).toContain('<h3 class="rec-name">Session log</h3>');
    expect(html.idle).toContain('On through the Claude Code hooks');
    expect(html.idle).toContain('shop-api · 42 events this session');
    expect(html.idle).toContain('<h3 class="rec-name">Screen video</h3>');
    expect(html.idle).toContain('Off until you click');
    expect(html.unavailable).toContain('Set DEVLENS_PROJECT_DIR to your project folder, then restart DevLens.');
  });

  it('keeps the desktop risk under its button, the lists beside the buttons, and one opt-in wording', () => {
    const choose = between(html.idle, '<div class="rec-choose">', '<div class="rec-lists">');
    expect(choose).toMatch(/Record my desktop<\/button><p id="desktop-risk" class="rec-risk">A separate choice\. A monitor take can show other windows and notifications\./);
    expect(html.idle).toContain('<div class="rec-lists">');
    expect(html.idle).not.toContain('second opt-in');
    // While recording the lists collapse to one line.
    expect(html.recording).not.toContain('rec-lists');
    expect(html.recording).toContain('Captured: the chosen window. Not captured: camera, microphone.');
  });

  it('shows take facts as label and value pairs, an error fix, and a next step after upload', () => {
    expect(html.review).toContain('<dt>Mode</dt><dd>Desktop</dd>');
    expect(html.review).toContain('<dt>Surface the browser reported</dt><dd>monitor</dd>');
    expect(html.review).toContain('This monitor take is labeled desktop.');
    expect(html.failed).toContain('Check that the server has DEVLENS_RECORD_ENABLED=1 and can reach Supabase, then click Upload again.');
    expect(html.uploaded).toContain('<a href="/record">Record another take</a>');
    expect(html.review).not.toContain('Record another take');
  });

  it('agent row: a switch and one status line, and no pop-up or queue on /record', () => {
    for (const name of ['idle', 'on', 'watching', 'offline', 'unavailable']) {
      expect(html[name]).not.toMatch(/<textarea|agent-popup|agent-queue|New question|widget-/);
      expect(html[name].match(/aria-live/g) ?? []).toHaveLength(0);
    }
    const sw = (h: string) => between(h, '<button type="button" role="switch"', '</button>');
    expect(sw(html.idle)).toContain('aria-checked="false"');
    expect(sw(html.idle)).toContain('DevLens Agent');
    expect(sw(html.on)).toContain('aria-checked="true"');
    expect(html.idle).toContain('<b>Off</b>');
    expect(html.on).toContain('<b>2 questions waiting · open the widget</b>');
    expect(html.on).not.toContain('Question a?');
    expect(html.watching).toContain('<b>Watching this session</b>');
    expect(html.offline).toContain('<b>Offline, retrying</b>');
    expect(html.unavailable).toContain('<b>Unavailable: set DEVLENS_PROJECT_DIR, then restart DevLens</b>');
    expect(sw(html.unavailable)).toContain('disabled');
  });

  it('mentions score, rank, or verdict only to say there is none', () => {
    for (const page of Object.values(html)) {
      const rest = page.replace('DevLens shows no score, rank, or verdict.', '').replace('No files, no diffs, no score.', '');
      expect(rest).not.toMatch(/score|rank|verdict/i);
    }
  });

  it('sharing row: an opt-in switch with its explainer, disabled when the route fails', () => {
    const switches = (h: string) => h.match(/<button type="button" role="switch"[^>]*>.*?<\/button>/g) ?? [];
    expect(switches(html.idle)).toHaveLength(2);
    expect(switches(html.idle)[1]).toContain('aria-checked="false"');
    expect(switches(html.idle)[1]).toContain('Share updates with recruiter');
    expect(switches(html.idle)[1]).not.toContain('disabled');
    expect(switches(html.sharing)[1]).toContain('aria-checked="true"');
    expect(html.idle).toContain('Your prompts (word for word, secrets removed) and facts from the session log (files changed, tests, answers) go to the recruiter page. No files, no diffs, no score.');
    expect(html.idle).toContain('<a href="/recruiter">');
    expect(switches(html.unavailable)[1]).toContain('disabled');
    expect(html.unavailable).toContain('Unavailable');
  });
});

describe('elapsed clock', () => {
  it('counts wall time since the start minus pauses, and stops at the end', () => {
    const base = { wallStartMs: 10_000, wallEndMs: null, pauses: [] };
    expect(clockOf({ ...base, wallStartMs: null }, 99_000)).toEqual({ ms: 0, text: '00:00' });
    expect(clockOf(base, 75_500)).toEqual({ ms: 65_500, text: '01:05' });
    expect(clockOf({ ...base, pauses: [{ pause_ms: 20_000, resume_ms: 50_000 }] }, 75_000).text).toBe('00:35');
    expect(clockOf({ ...base, wallEndMs: 3_610_000 }, 9_999_999).text).toBe('60:00');
  });
});

describe('sharing switch (EVAL-35)', () => {
  it('reads the opt-in once and makes no recruiter post while sharing stays off', async () => {
    const calls: { url: string; init?: { method?: string; body?: string } }[] = [];
    const fetcher = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ sharing: false, project: 'p', updates: [] }) };
    });
    const share = createShareSwitch(fetcher);
    await share.start();
    expect(share.snapshot()).toEqual({ phase: 'ready', sharing: false, error: null });
    expect(calls).toEqual([{ url: '/api/recruiter', init: undefined }]);
    await share.setSharing(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].init).toMatchObject({ method: 'POST', body: JSON.stringify({ type: 'share', enabled: true }) });
    expect(share.snapshot().sharing).toBe(true);
  });

  it('is unavailable on a 404 or a network error, and then posts nothing', async () => {
    for (const fetcher of [
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
      vi.fn(async () => { throw new Error('down'); }),
    ]) {
      const share = createShareSwitch(fetcher);
      await share.start();
      expect(share.snapshot().phase).toBe('unavailable');
      await share.setSharing(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps the old value and says how to fix a failed save', async () => {
    const fetcher = vi.fn(async (_url: string, init?: { method?: string }) => (
      init?.method === 'POST' ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ sharing: true, updates: [] }) }));
    const share = createShareSwitch(fetcher);
    await share.start();
    await share.setSharing(false);
    expect(share.snapshot()).toMatchObject({ sharing: true, error: expect.stringMatching(/try again/) });
  });
});
