import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('replay page source', () => {
  it('seeks the recording and keeps verdict words out of the page', async () => {
    const page = await readFile('apps/web/replay/page.tsx', 'utf8');
    const media = await readFile('apps/web/api/replay/media/route.ts', 'utf8');
    expect(page).toContain("video.current.currentTime = pending.current");
    expect(page).toContain('Open the first failed test');
    expect(page).toContain('commit diff, from git, not from the hook log');
    expect(page).toContain('Separate from the session test line.');
    expect(page).toContain('This take did not capture:');
    expect(page).toContain('answer_note');
    expect(page).toContain('aria-label="Recording of the Claude Code terminal"');
    expect(page).toContain('by session order, which is an inference');
    expect(page).toContain("get('offline') === '1'");
    expect(page).toContain('Coding-agent usage (context)');
    expect(page).toContain('Not answered.');
    expect(page).toContain('question.answer.text');
    expect(page).not.toMatch(/\b(efficient|score|rank|better|worse|hire)\b/i);
    expect(page).not.toContain('SUPABASE_SECRET_KEY');
    expect(page).not.toMatch(/NEXT_PUBLIC_\w*SECRET/);
    expect(media).toContain('goldenFile');
    expect(media).not.toContain('fixturePath');
  });
});
