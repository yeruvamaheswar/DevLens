// EVAL-6 (unit part): `t3 publish` uploads the right objects to a fake bucket, and the journey lists and loads them.
// The capture files are the committed sprintboard-rehearsal capture; the recording bytes are a stand-in, not a take.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listSources, loadJourney, publishedName } from '../../../apps/web/journey/sources';
import { captureBucketFromEnv, defaultPublishName, isPublishedName, publishCapture, webCaptureBucket, type CaptureBucket } from '../src/publish';

const SAVED = path.join(process.cwd(), 'examples', 't3-captures', 'sprintboard-rehearsal');
const HOME = '/Users/someone';
const dirs: string[] = [];

function captureFolder(withRecording: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-t3-publish-'));
  dirs.push(dir);
  for (const file of ['events.jsonl', 'edges.jsonl', 'capture.json', 'rerun.jsonl']) copyFileSync(path.join(SAVED, file), path.join(dir, file));
  // A home path to scrub, in a field the journey does not read.
  const capture = JSON.parse(readFileSync(path.join(dir, 'capture.json'), 'utf8'));
  writeFileSync(path.join(dir, 'capture.json'), JSON.stringify({ ...capture, note_path: `${HOME}/Code/app` }));
  if (withRecording) {
    writeFileSync(path.join(dir, 'recording.webm'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    writeFileSync(path.join(dir, 'recording-meta.json'), JSON.stringify({ consent: true, file: `${HOME}/take.webm` }));
  }
  return dir;
}

type FakeBucket = CaptureBucket & { objects: Map<string, { body: Buffer; type: string }>; order: string[]; downloads: string[] };

function fakeBucket(): FakeBucket {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const order: string[] = [];
  const downloads: string[] = [];
  return {
    objects,
    order,
    downloads,
    async upload(object, body, type) {
      objects.set(object, { body, type });
      order.push(object);
    },
    async list(folder) {
      const names = [...objects.keys()].filter((key) => (folder ? key.startsWith(`${folder}/`) : true)).map((key) => (folder ? key.slice(folder.length + 1) : key.split('/')[0]));
      return [...new Set(names)];
    },
    async download(object) {
      downloads.push(object);
      return objects.get(object)?.body ?? null;
    },
    async remove(list) {
      for (const object of list) objects.delete(object);
    },
    async signedUrl(object) {
      return objects.has(object) ? `https://signed.example/${object}?token=t` : null;
    },
  };
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('t3 publish', () => {
  it('uploads events, edges, rerun, and capture, never the recording without --with-recording', async () => {
    const bucket = fakeBucket();
    const uploaded = await publishCapture({ dir: captureFolder(true), name: 'rehearsal-2', withRecording: false, bucket, home: HOME });
    expect(uploaded.map((item) => item.object).sort()).toEqual(['rehearsal-2/capture.json', 'rehearsal-2/edges.jsonl', 'rehearsal-2/events.jsonl', 'rehearsal-2/rerun.jsonl']);
    expect([...bucket.objects.keys()].some((key) => key.includes('recording'))).toBe(false);
    expect(bucket.order.at(-1)).toBe('rehearsal-2/capture.json');
    expect(uploaded.every((item) => item.bytes === bucket.objects.get(item.object)?.body.length)).toBe(true);
    const capture = bucket.objects.get('rehearsal-2/capture.json')!;
    expect(capture.type).toBe('application/json');
    expect(capture.body.toString('utf8')).not.toContain(HOME);
    expect(JSON.parse(capture.body.toString('utf8')).note_path).toBe('~/Code/app');
    expect(bucket.objects.get('rehearsal-2/events.jsonl')?.type).toBe('application/x-ndjson');
  });

  it('uploads the recording and its meta only with --with-recording, and takes them down on a later publish without it', async () => {
    const bucket = fakeBucket();
    const dir = captureFolder(true);
    await publishCapture({ dir, name: 'rehearsal-2', withRecording: true, bucket, home: HOME });
    expect(bucket.objects.get('rehearsal-2/recording.webm')?.type).toBe('video/webm');
    expect(bucket.objects.get('rehearsal-2/recording-meta.json')?.body.toString('utf8')).toContain('~/take.webm');
    await publishCapture({ dir, name: 'rehearsal-2', withRecording: false, bucket, home: HOME });
    expect(bucket.objects.has('rehearsal-2/recording.webm')).toBe(false);
    expect(bucket.objects.has('rehearsal-2/recording-meta.json')).toBe(false);
  });

  it('refuses a bad name, a missing capture, and --with-recording with no recording', async () => {
    const bucket = fakeBucket();
    await expect(publishCapture({ dir: captureFolder(false), name: '../x', withRecording: false, bucket })).rejects.toThrow(/name/);
    await expect(publishCapture({ dir: path.join(tmpdir(), 'devlens-no-such-capture'), name: 'abc', withRecording: false, bucket })).rejects.toThrow(/Import the thread first/);
    await expect(publishCapture({ dir: captureFolder(false), name: 'abc', withRecording: true, bucket })).rejects.toThrow(/no recording.webm/);
    expect(bucket.objects.size).toBe(0);
  });

  it('derives a valid default name from a T3 thread id', () => {
    const name = defaultPublishName('thread:delegated-task:command%3Amcp%3Af42eb73e-1acb-4504-8217-f136ccd92d26%3Adelegate-task%3Adb072871');
    expect(isPublishedName(name)).toBe(true);
    expect(isPublishedName(defaultPublishName('ab'))).toBe(true);
  });
});

describe('published journey sources', () => {
  it('lists published captures as t3-pub:<name> and loads one with a media route', async () => {
    const bucket = fakeBucket();
    await publishCapture({ dir: captureFolder(true), name: 'rehearsal-2', withRecording: true, bucket, home: HOME });
    // One unreadable capture must not hide the other.
    await bucket.upload('broken-one/capture.json', Buffer.from('{not json'), 'application/json');
    const sources = await listSources(bucket);
    expect(sources[0].key).toBe('golden');
    const row = sources.find((source) => source.key === 't3-pub:rehearsal-2');
    expect(row).toMatchObject({ status: 'experimental', adapter: 't3_code' });
    expect(row?.label).toMatch(/\(published\)$/);
    expect(sources.some((source) => source.key === 't3-pub:broken-one')).toBe(false);

    const body = await loadJourney('t3-pub:rehearsal-2', bucket);
    expect(body?.journey.source.key).toBe('t3-pub:rehearsal-2');
    expect(body?.events.length).toBeGreaterThan(0);
    expect(body?.journey.source.media?.url).toBe('/api/journey/media?source=t3-pub%3Arehearsal-2');
  });

  it('has no media when the recording was not published', async () => {
    const bucket = fakeBucket();
    await publishCapture({ dir: captureFolder(true), name: 'no-video', withRecording: false, bucket, home: HOME });
    expect((await loadJourney('t3-pub:no-video', bucket))?.journey.source.media).toBeNull();
  });

  it('rejects keys that could name a path, without touching the bucket', async () => {
    const bucket = fakeBucket();
    for (const key of ['t3-pub:', 't3-pub:..', 't3-pub:../golden', 't3-pub:a/b', 't3-pub:ab', 't3-pub:Rehearsal', 't3-pub:%2e%2e', 't3-pub:a.b.c', 't3-pub:-abc']) {
      expect(publishedName(key), key).toBeNull();
      expect(await loadJourney(key, bucket), key).toBeNull();
    }
    expect(bucket.downloads).toEqual([]);
    expect(publishedName('t3-pub:rehearsal-2')).toBe('rehearsal-2');
  });

  it('has no published sources when the variables are missing or name another project', async () => {
    expect(captureBucketFromEnv({})).toBeNull();
    expect(captureBucketFromEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://hivfaqlabtbrhrviwrrm.supabase.co' })).toBeNull();
    expect(captureBucketFromEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co', SUPABASE_SECRET_KEY: 'x' })).toBeNull();
    const sources = await listSources(null);
    expect(sources.some((source) => source.key.startsWith('t3-pub:'))).toBe(false);
    expect(await loadJourney('t3-pub:rehearsal-2', null)).toBeNull();
  });
});

describe('slice 3 review fixes', () => {
  it('refuses to upload anything when a capture holds a secret value (finding 2)', async () => {
    for (const leak of ['sb_secret_abcdefghijklmnop', 'my-private-value-123']) {
      const dir = captureFolder(false);
      const events = readFileSync(path.join(dir, 'events.jsonl'), 'utf8');
      writeFileSync(path.join(dir, 'events.jsonl'), events + JSON.stringify({ id: 'leak', payload: { output: `KEY=${leak}` } }) + '\n');
      const bucket = fakeBucket();
      await expect(publishCapture({ dir, name: 'leak-check', withRecording: false, bucket, home: HOME, secrets: ['my-private-value-123'] })).rejects.toThrow(/secret value/);
      expect(bucket.order).toEqual([]);
    }
  });

  it('a local DEVLENS_OFFLINE=1 run lists no published captures; Vercel still does (finding 1)', () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://hivfaqlabtbrhrviwrrm.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_only_value' };
    expect(webCaptureBucket({ ...env, DEVLENS_OFFLINE: '1' })).toBeNull();
    expect(webCaptureBucket({ ...env, DEVLENS_OFFLINE: '1', VERCEL: '1' })).not.toBeNull();
    expect(webCaptureBucket(env)).not.toBeNull();
  });
});
