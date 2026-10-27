import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { planSession } from '../cli/src/link';
import type { Edge, Event, RecordingMeta, Replay } from './event';
import { attachMedia } from './src/sync';

export const goldenLabel = 'golden take, broken-api, 2026-10-27';
const SIGNED_URL_SECONDS = 1800;

function repoRoot(): string {
  return process.cwd().endsWith(`${path.sep}apps${path.sep}web`) ? path.resolve(process.cwd(), '../..') : process.cwd();
}

export function goldenFile(name: string): string {
  return path.join(repoRoot(), 'examples', 'broken-api', 'fixtures', 'golden', name);
}

function parseEvents(text: string, orderStart: number): { event: Event; order: number }[] {
  const loaded: { event: Event; order: number }[] = [];
  let order = orderStart;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      loaded.push({ event: JSON.parse(line) as Event, order: order++ });
    } catch {
      throw new Error(`Golden event line ${i + 1} is not JSON`);
    }
  }
  return loaded;
}

// Same order as `devlens link`: session file, media offsets, then the re-run with no media.
export async function localGoldenReplay(): Promise<Replay> {
  const meta = JSON.parse(await readFile(goldenFile('meta.json'), 'utf8')) as RecordingMeta;
  let loaded = parseEvents(await readFile(goldenFile('session.jsonl'), 'utf8'), 0);
  const withMedia = attachMedia(loaded.map((item) => item.event), meta);
  loaded = loaded.map((item, index) => ({ ...item, event: withMedia[index] }));
  const rerun = parseEvents(await readFile(goldenFile('rerun.jsonl'), 'utf8'), loaded.length);
  const plan = planSession([...loaded, ...rerun]);
  return {
    mode: 'local fixture',
    label: goldenLabel,
    events: plan.events,
    edges: plan.edges,
    media: { url: '/api/replay/media', expires_at: null },
    warning: 'Local golden files. The recording is the consented window take. The worker re-run is separate from the session test line.',
  };
}

// Anon RLS still allows only tracer-fixture-1. This server reads the golden sessions
// with the same service role it uses to sign the private recording.
async function supabaseGolden(local: Replay): Promise<Replay> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('configuration unavailable');
  if (new URL(url).hostname !== 'hivfaqlabtbrhrviwrrm.supabase.co') throw new Error('project unavailable');
  const sessionIds = [...new Set(local.events.map((event) => event.session_id))];
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const eventsResult = await admin.from('events').select('*').in('session_id', sessionIds);
  if (eventsResult.error || !eventsResult.data?.length) throw new Error('fixture unavailable');
  const events = eventsResult.data as Event[];
  const localIds = new Set(local.events.map((event) => event.id));
  if (events.length !== localIds.size || events.some((event) => !localIds.has(event.id))) throw new Error('fixture unavailable');
  const edgesResult = await admin.from('edges').select('*');
  if (edgesResult.error || !edgesResult.data) throw new Error('fixture unavailable');
  const byId = new Map((edgesResult.data as Edge[]).map((edge) => [edge.id, edge]));
  const edges = local.edges.map((edge) => byId.get(edge.id));
  if (edges.some((edge) => !edge)) throw new Error('fixture unavailable');
  const selected = edges as Edge[];
  const ref = events.find((event) => event.recording_ref)?.recording_ref;
  if (!ref) throw new Error('media reference unavailable');
  const signed = await admin.storage.from('recordings').createSignedUrl(ref, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data) throw new Error('signing unavailable');
  return {
    mode: 'supabase',
    label: goldenLabel,
    events,
    edges: selected,
    media: { url: signed.data.signedUrl, expires_at: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() },
    warning: 'Supabase golden take. Private window recording. The worker re-run is separate from the session test line.',
  };
}

export async function loadReplay(offline = false): Promise<Replay> {
  const local = await localGoldenReplay();
  if (offline || process.env.DEVLENS_OFFLINE === '1') return local;
  try {
    return await supabaseGolden(local);
  } catch {
    return { ...local, warning: `Supabase unavailable; using local golden files. ${local.warning}` };
  }
}
