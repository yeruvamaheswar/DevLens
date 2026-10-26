import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadReplay } from './server';
import type { Replay } from './event';
import { readFile } from 'node:fs/promises';
import { fixturePath } from './fixture';
try { process.loadEnvFile?.('.env'); } catch { /* Offline command needs no environment file. */ }
const offline = process.argv.includes('--offline');
let failures = 0;
async function check(name: string, run: () => Promise<void> | void) {
 try {
  await run();
  console.log(`PASS: ${name}`);
 } catch {
  // Do not print SDK errors or responses, which may contain credentials.
  failures++;
  console.log(`FAIL: ${name}`);
 }
}
function skip(name: string, reason: string) {
 console.log(`SKIPPED(${reason}): ${name}`);
}
let replay: Replay | undefined;
await check('replay fixture', async () => {
 replay = await loadReplay(offline);
 assert.equal(replay.label, 'tracer fixture, hand-authored');
});
if (replay) {
 const loaded = replay;
 await check('deterministic link', () => {
  assert(loaded.edges.some(e => e.rel === 'verifies' && e.derived_by && e.evidence_event_ids.includes('failure')));
 });
} else skip('deterministic link', 'replay fixture failed');
await check('WebM fixture header', async () => {
 const media = await readFile(fixturePath('session.webm'));
 assert.equal(media.subarray(0, 4).toString('hex'), '1a45dfa3');
});
const liveChecks = ['Supabase fixture', 'RLS insert denial', 'signed private media'];
const reason = offline ? 'offline requested' : !process.env.SUPABASE_SECRET_KEY ? 'SUPABASE_SECRET_KEY absent' : undefined;
if (reason) {
 for (const name of liveChecks) skip(name, reason);
} else {
 const loaded = replay;
 await check('Supabase fixture', () => {
  assert(loaded);
  assert.equal(loaded.mode, 'supabase');
 });
 await check('RLS insert denial', async () => {
  assert(loaded?.events.length);
  const reader = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {auth: {persistSession: false}});
  const {error} = await reader.from('events').insert({...loaded.events[0], id: 'rls-denial-probe'});
  if (!error) {
   const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {auth: {persistSession: false}});
   await admin.from('events').delete().eq('id', 'rls-denial-probe');
   throw new Error('RLS regression');
  }
  assert.equal(error.code, '42501');
 });
 await check('signed private media', async () => {
  assert(loaded);
  assert.equal(loaded.mode, 'supabase');
  const response = await fetch(loaded.media.url, {headers: {Range: 'bytes=0-3'}});
  assert(response.ok);
 });
}
process.exitCode = failures ? 1 : 0;
