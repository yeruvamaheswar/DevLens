import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { captureBucketFromEnv } from '../../../../../packages/t3/src/publish';
import { captureDir, publishedName } from '../../../journey/sources';
import { loadRepoEnv } from '../../recordings/storage';

export const runtime = 'nodejs';

const SIGNED_URL_SECONDS = 600;

// Serves the take of one T3 capture (recording.webm in its folder). Never a path from the request.
// A published capture redirects to a short-lived signed URL for its private object; the bucket is never public.
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('source') ?? '';
  const name = publishedName(key);
  if (name) {
    loadRepoEnv();
    const bucket = captureBucketFromEnv();
    const url = bucket ? await bucket.signedUrl(`${name}/recording.webm`, SIGNED_URL_SECONDS) : null;
    if (!url) return new Response('Recording unavailable.', { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
  }
  const dir = captureDir(key);
  if (!dir) return new Response('Recording unavailable.', { status: 404 });
  let file: Buffer;
  try {
    file = await readFile(path.join(dir, 'recording.webm'));
  } catch {
    return new Response('Recording unavailable.', { status: 404 });
  }
  const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = request.headers.get('range');
  if (!range) return new Response(new Uint8Array(file), { headers: { ...headers, 'Content-Length': String(file.length) } });
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.length}` } });
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : file.length - 1, file.length - 1);
  if (start > end || start >= file.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.length}` } });
  return new Response(new Uint8Array(file.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) } });
}
