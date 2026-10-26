import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('record page source', () => {
  it('shows consent and starts capture only from the Start recording click', async () => {
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(page).toContain('Nothing is recorded until you click Start recording.');
    expect(page).toContain('chosen window');
    expect(page).toContain('Prompts, tool calls, diffs, and output');
    expect(page).toContain('Test results');
    expect(page).toContain('typed answer');
    expect(page).toContain('Camera');
    expect(page).toContain('Microphone');
    expect(page).toContain('whole desktop');
    expect(page).toContain('score');
    expect(page).toContain('Start recording');
    expect(page).toContain('onClick={() => { void session.start(); }}');
    expect(page).toContain('onClick={() => session.deleteTake()}');
    expect(page).toContain('onClick={() => { void session.upload(); }}');
    expect(page).not.toContain('getDisplayMedia');
    expect(page).not.toContain('getUserMedia');
    expect(page).not.toContain('SUPABASE_SECRET_KEY');
    expect(page).not.toMatch(/useEffect\([^)]*session\.start/);
  });
});
