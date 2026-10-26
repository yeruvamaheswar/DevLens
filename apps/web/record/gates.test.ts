import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { projectOrigin } from './project';
import { recordingIdFromMetaUrl, sameOrigin } from '../api/recordings/gates';
import { postGrant, postMeta, type StoragePort } from '../api/recordings/handler';
import { openRecordingStorage } from '../api/recordings/storage';

const ID = '00000000-0000-4000-8000-000000000001';
const ORIGIN = 'http://localhost:3000';

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, host: 'localhost:3000', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function storage(overrides: Partial<StoragePort> = {}): StoragePort & { uploads: string[]; metas: string[] } {
  const uploads: string[] = [];
  const metas: string[] = [];
  return {
    uploads,
    metas,
    async createSignedUploadUrl(path) {
      uploads.push(path);
      return { ok: true, token: 'signed-token' };
    },
    async writeMeta(path, body) {
      metas.push(`${path}\n${body}`);
      return { ok: true };
    },
    ...overrides,
  };
}

const validMeta = {
  recording_id: ID,
  mode: 'window',
  display_surface: 'window',
  consent: true,
  audio_tracks: 0,
  video_tracks: 1,
  wall_start_ms: 1_000,
  wall_end_ms: 20_000,
  pauses: [{ pause_ms: 5_000, resume_ms: 10_000 }],
  bytes: 32,
};

describe('recording gates', () => {
  it('refuses a grant without the flag, a matching origin, or consent', async () => {
    const calls: string[] = [];
    const deps = {
      enabledFlag: undefined as string | undefined,
      openStorage: () => { calls.push('open'); return storage(); },
    };
    expect((await postGrant(request('/api/recordings', { mode: 'window', consent: true }), deps)).status).toBe(403);
    deps.enabledFlag = '1';
    const cross = request('/api/recordings', { mode: 'window', consent: true }, { origin: 'https://evil.example' });
    expect((await postGrant(cross, deps)).status).toBe(403);
    expect((await postGrant(request('/api/recordings', { mode: 'window', consent: false }), deps)).status).toBe(400);
    expect((await postGrant(request('/api/recordings', { mode: 'window' }), deps)).status).toBe(400);
    expect((await postGrant(request('/api/recordings', { mode: 'desktop', consent: true }), deps)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('returns a server path and token for one consented window', async () => {
    const port = storage();
    const response = await postGrant(request('/api/recordings', { mode: 'window', consent: true }), {
      enabledFlag: '1',
      openStorage: () => port,
      newId: () => ID,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recording_id: ID, path: `${ID}/take.webm`, token: 'signed-token' });
    expect(port.uploads).toEqual([`${ID}/take.webm`]);
    expect(port.metas).toEqual([]);
  });

  it('validates metadata and writes meta.json without a database write', async () => {
    const port = storage();
    const deps = { enabledFlag: '1', openStorage: () => port };
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, consent: false }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, audio_tracks: 1 }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, video_tracks: 2 }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, display_surface: 'monitor' }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, recording_id: '00000000-0000-4000-8000-000000000002' }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, wall_end_ms: null }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, {
      ...validMeta,
      pauses: [{ pause_ms: 9_000, resume_ms: 12_000 }, { pause_ms: 5_000, resume_ms: 8_000 }],
    }), deps)).status).toBe(400);
    expect((await postMeta(request(`/api/recordings/${ID}/meta`, {
      ...validMeta,
      pauses: [{ pause_ms: 500, resume_ms: 800 }],
    }), deps)).status).toBe(400);
    expect(port.metas).toEqual([]);

    const response = await postMeta(request(`/api/recordings/${ID}/meta`, { ...validMeta, recording_ref: 'evil/path' }), deps);
    expect(response.status).toBe(200);
    const [entry] = port.metas;
    const [objectPath, raw] = entry.split('\n');
    expect(objectPath).toBe(`${ID}/meta.json`);
    expect(JSON.parse(raw)).toMatchObject({ ...validMeta, recording_ref: `${ID}/take.webm` });
    expect(JSON.parse(raw).recording_ref).not.toBe('evil/path');
  });

  it('refuses every Supabase host except the DevLens project', () => {
    expect(projectOrigin('https://hivfaqlabtbrhrviwrrm.supabase.co')).toBe('https://hivfaqlabtbrhrviwrrm.supabase.co');
    expect(projectOrigin('https://hivfaqlabtbrhrviwrrm.supabase.co/storage/v1')).toBe('https://hivfaqlabtbrhrviwrrm.supabase.co');
    const refused = [
      'https://example.supabase.co',
      'https://hivfaqlabtbrhrviwrrm.supabase.co.evil.example',
      'http://hivfaqlabtbrhrviwrrm.supabase.co',
      'not a url',
      undefined,
    ];
    for (const host of refused) {
      let connected = false;
      expect(openRecordingStorage({ url: host, secret: 'local-test-secret' }, () => {
        connected = true;
        return storage();
      })).toBeNull();
      expect(connected).toBe(false);
    }
    let origin = '';
    const opened = openRecordingStorage(
      { url: 'https://hivfaqlabtbrhrviwrrm.supabase.co', secret: 'local-test-secret' },
      (nextOrigin) => {
        origin = nextOrigin;
        return storage();
      },
    );
    expect(origin).toBe('https://hivfaqlabtbrhrviwrrm.supabase.co');
    expect(opened).not.toBeNull();
  });

  it('matches the request host and a recording id in the meta path', () => {
    expect(sameOrigin(request('/api/recordings', {}))).toBe(true);
    expect(sameOrigin(new Request(`${ORIGIN}/api/recordings`, { method: 'POST' }))).toBe(false);
    expect(recordingIdFromMetaUrl(`${ORIGIN}/api/recordings/${ID}/meta`)).toBe(ID);
    expect(recordingIdFromMetaUrl(`${ORIGIN}/api/recordings/..%2Fsecret/meta`)).toBeNull();
  });

  it('keeps route wrappers free of storage logic', async () => {
    const grant = await readFile('apps/web/app/api/recordings/route.ts', 'utf8');
    const meta = await readFile('apps/web/app/api/recordings/[id]/meta/route.ts', 'utf8');
    const page = await readFile('apps/web/app/record/page.tsx', 'utf8');
    expect(grant).toBe("export { POST } from '../../../api/recordings/route';\nexport const runtime = 'nodejs';\n");
    expect(meta).toBe("export { POST } from '../../../../../api/recordings/meta/route';\nexport const runtime = 'nodejs';\n");
    expect(page).toBe("export { default } from '../../record/page';\n");
    const canonical = await readFile('apps/web/api/recordings/storage.ts', 'utf8');
    expect(canonical).toContain('upsert: false');
    expect(canonical).not.toContain('upsert: true');
    expect(canonical).not.toContain(".from('events')");
    expect(canonical).not.toContain('.from("edges")');
    expect(canonical).not.toContain(".from('entities')");
  });
});
