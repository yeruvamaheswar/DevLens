import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('record page source', () => {
  it('shows consent and starts capture only from the Start recording click', async () => {
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(page).toContain('Nothing is recorded until you click Record one window or Record my desktop (second opt-in).');
    expect(page).toContain('chosen window');
    expect(page).toContain('Prompts, tool calls, diffs, and output');
    expect(page).toContain('Test results');
    expect(page).toContain('typed answer');
    expect(page).toContain('Camera');
    expect(page).toContain('Microphone');
    expect(page).toContain('The whole desktop, unless you choose Record my desktop (second opt-in)');
    expect(page).toContain('score');
    expect(page).toContain('Record one window');
    expect(page).not.toContain('click Start recording');
    expect(page).toContain('onClick={() => { void session.start(); }}');
    expect(page).toContain('onClick={() => session.deleteTake()}');
    expect(page).toContain('onClick={() => { void session.upload(); }}');
    expect(page).not.toContain('getDisplayMedia');
    expect(page).not.toContain('getUserMedia');
    expect(page).not.toContain('SUPABASE_SECRET_KEY');
    expect(page).not.toMatch(/useEffect\([^)]*session\.start/);
  });

  it('starts desktop only from its own click and shows the desktop consent and mode label', async () => {
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(page).toContain('Record one window');
    expect(page).toContain('Record my desktop (second opt-in)');
    expect(page).toContain('onClick={() => { void session.start(); }}');
    expect(page).toContain('onClick={() => { void session.startDesktop(); }}');
    expect(page).toContain('A monitor take can show other windows and notifications.');
    expect(page).toContain('Audio and camera stay off.');
    expect(page).toContain('You can delete the take before upload.');
    expect(page).toContain('Take mode: {snap.mode}.');
    expect(page).toContain('Captured surface: {snap.displaySurface}.');
    expect(page).toContain('This monitor take is labeled desktop.');
    expect(page).toContain('saved display_surface');
    expect(page).not.toContain('getUserMedia');
    expect(page).not.toContain('audio: true');
    expect(page).not.toContain('onKeyDown');
    expect(page).not.toContain('keydown');
    expect(page).not.toContain('keystroke');
    const windowClick = page.indexOf('onClick={() => { void session.start(); }}');
    const desktopClick = page.indexOf('onClick={() => { void session.startDesktop(); }}');
    expect(windowClick).toBeGreaterThan(-1);
    expect(desktopClick).toBeGreaterThan(windowClick);
  });
});
