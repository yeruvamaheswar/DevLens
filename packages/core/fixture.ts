import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Event, PostSessionAnswer, Replay, UsageRecord } from './event';
import { loadUsage } from './usage';
import { linkTracer } from '../link/src/tracer';
export const sessionId = 'tracer-fixture-1';
export const fixtureLabel = 'tracer fixture, hand-authored';
export function fixturePath(name: string) { return path.join(process.cwd().endsWith('apps/web') ? path.resolve(process.cwd(),'../..') : process.cwd(), 'examples/broken-api/fixtures', name); }
export async function localReplay(): Promise<Replay> {
 const events = (await readFile(fixturePath('session.jsonl'),'utf8')).trim().split('\n').map(line => JSON.parse(line) as Event);
 return {mode:'local fixture',label:fixtureLabel,events,edges:linkTracer(events),media:{url:'/api/replay/media',expires_at:null},warning:'Generated placeholder video; visual review pending. No live capture or independent re-run.'};
}
export type GoldenExtras = { usage: UsageRecord[]; answers: PostSessionAnswer[] };
// Local files in both modes. A missing file means an empty list.
export async function loadAnswers(file: string): Promise<PostSessionAnswer[]> {
 let text: string;
 try { text = await readFile(file,'utf8'); } catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
  throw error;
 }
 return text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as PostSessionAnswer);
}
export async function loadGoldenExtras(): Promise<GoldenExtras> {
 return { usage: await loadUsage(fixturePath('golden/usage.jsonl')), answers: await loadAnswers(fixturePath('golden/answers.jsonl')) };
}
