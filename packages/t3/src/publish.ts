// Publishes one local T3 capture to the private `t3-captures` bucket, so the hosted journey shows it without a Git push.
// Server key only; the bucket has no anon or authenticated policies. The journey reads published captures through the same port.
//   npm run t3 -- publish --thread <id> [--as <name>] [--with-recording]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { secretValuesFromEnv } from '../../capture/redact';

export const CAPTURE_BUCKET = 't3-captures';
const PROJECT_HOST = 'hivfaqlabtbrhrviwrrm.supabase.co';
// Same rule as `save --as`: one folder name, no separators, no dots, so a key cannot name a path.
const NAME = /^[a-z0-9][a-z0-9-]{2,60}$/;

const NDJSON = 'application/x-ndjson';
const CAPTURE_FILES: [string, string][] = [['events.jsonl', NDJSON], ['edges.jsonl', NDJSON], ['rerun.jsonl', NDJSON]];
const RECORDING_META: [string, string] = ['recording-meta.json', 'application/json'];
const RECORDING: [string, string] = ['recording.webm', 'video/webm'];

// The storage calls publish and the journey need. Tests pass a fake.
export type CaptureBucket = {
  upload(object: string, body: Buffer, contentType: string): Promise<void>;
  // Names directly under a folder; '' lists the published capture names.
  list(folder: string): Promise<string[]>;
  download(object: string): Promise<Buffer | null>;
  remove(objects: string[]): Promise<void>;
  signedUrl(object: string, seconds: number): Promise<string | null>;
};

export function isPublishedName(name: string): boolean {
  return NAME.test(name);
}

// `--as` is optional. The default is the thread id as a valid name: lowercase, dashes, at most 61 characters.
export function defaultPublishName(threadId: string): string {
  const slug = threadId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 61).replace(/-+$/, '');
  return slug.length >= 3 ? slug : `t3-${slug}`.replace(/-+$/, '');
}

// Null when the variables are missing or name another project. Callers treat null as "no published captures".
// Every storage call times out (review finding 1), so a missing network never hangs the journey's source list.
export function captureBucketFromEnv(env: Record<string, string | undefined> = process.env, timeoutMs = 5000): CaptureBucket | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== PROJECT_HOST) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
  const bucket = createClient(origin, secret, { auth: { persistSession: false }, global: { fetch: timedFetch } }).storage.from(CAPTURE_BUCKET);
  return {
    async upload(object, body, contentType) {
      const { error } = await bucket.upload(object, body, { contentType, upsert: true });
      if (error) throw new Error(`Upload of ${object} failed: ${error.message}`);
    },
    async list(folder) {
      const { data, error } = await bucket.list(folder, { limit: 1000 });
      if (error) throw new Error(`The ${CAPTURE_BUCKET} bucket could not be listed.`);
      return (data ?? []).map((item) => item.name);
    },
    async download(object) {
      const { data, error } = await bucket.download(object);
      return error || !data ? null : Buffer.from(await data.arrayBuffer());
    },
    async remove(objects) {
      if (!objects.length) return;
      const { error } = await bucket.remove(objects);
      if (error) throw new Error(`Removing old objects failed: ${error.message}`);
    },
    async signedUrl(object, seconds) {
      const { data, error } = await bucket.createSignedUrl(object, seconds);
      return error || !data ? null : data.signedUrl;
    },
  };
}

// For the web routes. `DEVLENS_OFFLINE=1` on a local machine means no network, so no published captures.
// Vercel sets VERCEL=1; the hosted site keeps DEVLENS_OFFLINE=1 for the golden replay and still lists published captures.
export function webCaptureBucket(env: Record<string, string | undefined> = process.env): CaptureBucket | null {
  if (env.DEVLENS_OFFLINE === '1' && !env.VERCEL) return null;
  return captureBucketFromEnv(env);
}

export type PublishOptions = { dir: string; name: string; withRecording: boolean; bucket: CaptureBucket; home?: string; secrets?: readonly string[] };
export type Uploaded = { object: string; bytes: number };

// The web routes import this file for the bucket port only; the turbopackIgnore comments keep these CLI-side reads
// from tracing the whole project into the server bundle.
// Uploads the capture with home paths as ~ (the same scrub as `save`). capture.json goes last, so a half-finished
// publish is never listed. Objects from an earlier publish that this one does not include are removed,
// so publishing again without --with-recording takes a published recording down.
export async function publishCapture(options: PublishOptions): Promise<Uploaded[]> {
  const { dir, name, withRecording, bucket } = options;
  if (!isPublishedName(name)) throw new Error('The published name must be lowercase letters, digits, and dashes (3 to 61 characters).');
  if (!existsSync(/*turbopackIgnore: true*/ path.join(dir, 'capture.json')) || !existsSync(/*turbopackIgnore: true*/ path.join(dir, 'events.jsonl'))) throw new Error(`Import the thread first: no capture.json and events.jsonl in ${dir}.`);
  if (withRecording && !existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, RECORDING[0]))) throw new Error(`--with-recording was given, but ${dir} has no ${RECORDING[0]}.`);
  const home = options.home ?? homedir();
  const scrub = (text: string) => (home.length > 1 ? text.split(home).join('~') : text);
  const text: [string, string][] = [...CAPTURE_FILES, ...(withRecording ? [RECORDING_META] : []), ['capture.json', 'application/json']];
  const uploaded: Uploaded[] = [];
  // Last guard before anything leaves the machine (review finding 2): no secret value from the environment, and no
  // Supabase secret key, in any text file. Import-time redaction should already have removed them.
  const secrets = (options.secrets ?? secretValuesFromEnv(process.env)).filter((value) => value.length >= 8);
  for (const [file] of text) {
    const source = path.join(/*turbopackIgnore: true*/ dir, file);
    if (!existsSync(/*turbopackIgnore: true*/ source)) continue;
    const body = readFileSync(/*turbopackIgnore: true*/ source, 'utf8');
    if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(body) || secrets.some((value) => body.includes(value))) {
      throw new Error(`${file} contains a secret value. Nothing was uploaded. Re-import the thread, check the capture, then publish again.`);
    }
  }
  const put = async (file: string, body: Buffer, contentType: string) => {
    const object = `${name}/${file}`;
    await bucket.upload(object, body, contentType);
    uploaded.push({ object, bytes: body.length });
  };
  if (withRecording) await put(RECORDING[0], readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, RECORDING[0])), RECORDING[1]);
  for (const [file, contentType] of text) {
    const source = path.join(/*turbopackIgnore: true*/ dir, file);
    if (existsSync(/*turbopackIgnore: true*/ source)) await put(file, Buffer.from(scrub(readFileSync(/*turbopackIgnore: true*/ source, 'utf8')), 'utf8'), contentType);
  }
  const kept = new Set(uploaded.map((item) => item.object));
  const stale = (await bucket.list(name)).map((file) => `${name}/${file}`).filter((object) => !kept.has(object));
  await bucket.remove(stale);
  return uploaded;
}
