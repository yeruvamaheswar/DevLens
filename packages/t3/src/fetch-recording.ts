// Copies one uploaded, consented window take from the private `recordings` bucket into a T3 capture folder,
// so the recruiter journey can play it offline. Server key only; it never reaches the browser.
//   npx tsx packages/t3/src/fetch-recording.ts --recording <recording id> --thread <T3 thread id>
//   npx tsx packages/t3/src/fetch-recording.ts --latest --thread <T3 thread id>   (newest uploaded take)
// Then: npm run t3 -- import --thread <id> --recording .devlens/t3/<id>/recording-meta.json
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { RecordingMeta } from '../../core/event';

const PROJECT_HOST = 'hivfaqlabtbrhrviwrrm.supabase.co';
const ID = /^[a-z0-9-]{8,64}$/;
const THREAD = /^[A-Za-z0-9._:%-]{6,300}$/;

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  try { process.loadEnvFile?.('.env'); } catch { /* use the process environment */ }
  const thread = arg('thread') ?? '';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.');
  if (new URL(url).hostname !== PROJECT_HOST) throw new Error('Only the devlens Supabase project is allowed.');
  const bucket = createClient(url, secret, { auth: { persistSession: false } }).storage.from('recordings');
  let recording = arg('recording')?.toLowerCase() ?? '';
  if (process.argv.includes('--latest')) {
    const folders = await bucket.list('', { limit: 100 });
    if (folders.error) throw new Error('The recordings bucket could not be listed.');
    let newest: { id: string; at: string } | null = null;
    for (const folder of folders.data ?? []) {
      if (!ID.test(folder.name)) continue;
      const files = await bucket.list(folder.name, { limit: 10 });
      const meta = files.data?.find((file) => file.name === 'meta.json');
      const at = meta?.created_at ?? null;
      if (at && (!newest || at > newest.at)) newest = { id: folder.name, at };
    }
    if (!newest) throw new Error('No uploaded take with a meta file was found.');
    recording = newest.id;
    console.log(`Newest uploaded take: ${recording} (meta written ${newest.at})`);
  }
  if (!ID.test(recording) || !THREAD.test(thread) || thread.includes('..')) throw new Error('Usage: --recording <id> | --latest, and --thread <T3 thread id>');

  const metaFile = await bucket.download(`${recording}/meta.json`);
  if (metaFile.error || !metaFile.data) throw new Error('The recording meta could not be read. Was the take uploaded?');
  const meta = JSON.parse(await metaFile.data.text()) as RecordingMeta;
  if (meta.consent !== true || meta.audio_tracks !== 0 || meta.video_tracks !== 1) throw new Error('The take lacks consent, has audio, or has the wrong track count. Not copied.');
  const video = await bucket.download(meta.recording_ref);
  if (video.error || !video.data) throw new Error('The recording file could not be read.');

  const out = path.join(process.cwd(), '.devlens', 't3', thread);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'recording-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(path.join(out, 'recording.webm'), Buffer.from(await video.data.arrayBuffer()));
  console.log(`Copied take ${recording} (${meta.mode}, ${meta.pauses.length} pauses) into ${out}`);
  console.log(`Next: npm run t3 -- import --thread ${thread} --recording ${path.join(out, 'recording-meta.json')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
