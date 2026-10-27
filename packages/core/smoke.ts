import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { goldenFile, goldenLabel, loadReplay } from './server';
import type { Replay } from './event';
import { readFile } from 'node:fs/promises';
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
function assertGoldenChain(loaded: Replay) {
 assert.equal(loaded.label, goldenLabel);
 assert.equal(loaded.events.length, 31);
 assert.equal(loaded.edges.length, 32);
 assert(loaded.events.every((event) => event.session_id !== 'tracer-fixture-1'));
 const verifies = loaded.edges.find((edge) => edge.rel === 'verifies' && edge.derived_by === 'rule-5-later-pass-v1');
 assert(verifies);
 const byId = new Map(loaded.events.map((event) => [event.id, event]));
 const cited = verifies.evidence_event_ids.map((id) => byId.get(id));
 assert(cited.every(Boolean));
 const pass = cited.find((event) => event?.type === 'test' && event.payload.status === 'passed' && event.source !== 'sandbox');
 assert(pass);
 assert(cited.some((event) => event?.type === 'test' && event.payload.status === 'failed' && event.source !== 'sandbox'));
 assert(loaded.events.some((event) => event.source === 'sandbox' && event.payload.signal === 'rerun' && event.payload.rerun_of === pass.id));
 const first = loaded.events
  .filter((event) => event.type === 'test' && event.source !== 'sandbox' && event.payload.status === 'failed')
  .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))[0];
 assert(first.media_offset_ms != null && first.media_offset_ms >= 25000 && first.media_offset_ms <= 40000);
 assert(pass.media_offset_ms != null && pass.media_offset_ms >= 170000 && pass.media_offset_ms <= 185000);
 assert(loaded.events.filter((event) => event.source !== 'sandbox').every((event) => event.media_offset_ms != null));
 assert.equal(loaded.events.find((event) => event.source === 'sandbox')?.media_offset_ms ?? null, null);
}
await check('replay fixture', async () => {
 replay = await loadReplay(offline);
 assertGoldenChain(replay);
 if (offline) assert.equal(replay.mode, 'local fixture');
});
await check('WebM fixture header', async () => {
 const media = await readFile(goldenFile('session.webm'));
 assert.equal(media.subarray(0, 4).toString('hex'), '1a45dfa3');
 assert.equal(media.length, 16047324);
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
