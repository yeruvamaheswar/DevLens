import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Event, Replay } from './event';
import { linkTracer } from '../link/src/tracer';
export const sessionId = 'tracer-fixture-1';
export const fixtureLabel = 'tracer fixture, hand-authored';
export function fixturePath(name: string) { return path.join(process.cwd().endsWith('apps/web') ? path.resolve(process.cwd(),'../..') : process.cwd(), 'examples/broken-api/fixtures', name); }
export async function localReplay(): Promise<Replay> {
 const events = (await readFile(fixturePath('session.jsonl'),'utf8')).trim().split('\n').map(line => JSON.parse(line) as Event);
 return {mode:'local fixture',label:fixtureLabel,events,edges:linkTracer(events),media:{url:'/api/replay/media',expires_at:null},warning:'Generated placeholder video; visual review pending. No live capture or independent re-run.'};
}
