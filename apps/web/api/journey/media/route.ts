import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { t3Dir } from '../../../journey/sources';

export const runtime = 'nodejs';

// Serves a local T3 take copied into .devlens/t3/<thread>/recording.webm. Never a path from the request.
export async function GET(request: Request) {
  const dir = t3Dir(new URL(request.url).searchParams.get('thread') ?? '');
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
