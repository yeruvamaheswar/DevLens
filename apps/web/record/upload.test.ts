import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { stopTake, startTake, idleTake } from './take';
import { uploadReviewedTake } from './upload';

const ID = '00000000-0000-4000-8000-000000000001';

describe('uploadReviewedTake', () => {
  it('uploads with the publishable client after review and posts details without a recording_ref', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const signed: Array<{ key: string; path: string; token: string }> = [];
    const take = stopTake(startTake(idleTake(), 1_000, 'window'), 2_000);
    await uploadReviewedTake({
      supabaseUrl: 'https://hivfaqlabtbrhrviwrrm.supabase.co',
      publishableKey: 'publishable-test-key',
      blob: new Blob(['webm']),
      take,
      fetchImpl: async (input, init) => {
        seen.push({ url: String(input), body: String(init?.body ?? '') });
        if (String(input) === '/api/recordings') {
          return Response.json({ recording_id: ID, path: `${ID}/take.webm`, token: 'signed-token' });
        }
        return Response.json({ ok: true });
      },
      uploadToSignedUrl: async (input) => {
        signed.push({ key: input.publishableKey, path: input.path, token: input.token });
      },
    });
    expect(JSON.parse(seen[0].body)).toEqual({ mode: 'window', consent: true });
    expect(signed).toEqual([{ key: 'publishable-test-key', path: `${ID}/take.webm`, token: 'signed-token' }]);
    const meta = JSON.parse(seen[1].body) as Record<string, unknown>;
    expect(meta.recording_ref).toBeUndefined();
    expect(meta).toMatchObject({ recording_id: ID, audio_tracks: 0, video_tracks: 1, consent: true, mode: 'window' });
    expect(seen[1].url).toBe(`/api/recordings/${ID}/meta`);
  });

  it('does not call storage for a different Supabase host', async () => {
    let called = false;
    await expect(uploadReviewedTake({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'publishable-test-key',
      blob: new Blob(['webm']),
      take: stopTake(startTake(idleTake(), 1, 'window'), 2),
      fetchImpl: async () => { called = true; return Response.json({}); },
      uploadToSignedUrl: async () => { called = true; },
    })).rejects.toThrow('recording storage is unavailable');
    expect(called).toBe(false);
  });

  it('keeps the service-role name out of the browser modules', async () => {
    const upload = await readFile('apps/web/record/upload.ts', 'utf8');
    const browser = await readFile('apps/web/record/browser.ts', 'utf8');
    const page = await readFile('apps/web/record/page.tsx', 'utf8');
    expect(upload).not.toContain('SUPABASE_SECRET_KEY');
    expect(browser).not.toContain('SUPABASE_SECRET_KEY');
    expect(browser).not.toContain('getUserMedia');
    expect(page).not.toContain('SUPABASE_SECRET_KEY');
    expect(page).not.toContain('getDisplayMedia');
    expect(page).not.toContain('getUserMedia');
  });
});
