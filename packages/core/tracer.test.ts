import { describe,it,expect } from 'vitest';
import { linkTracer } from '../link/src/tracer';
import { localReplay } from './fixture';
import { readFile } from 'node:fs/promises';
describe('deterministic tracer',()=>{
 it('links a hand-authored two-event JSONL with a cited rule',async()=>{
  const fixture=await localReplay();
  const jsonl=fixture.events.filter(e=>e.type==='test').map(e=>JSON.stringify({...e,payload:{...e.payload,patch_event_id:undefined}})).join('\n');
  const edge=linkTracer(jsonl.split('\n').map(line=>JSON.parse(line)))[0];
  expect(edge).toMatchObject({rel:'verifies',derived_by:'rule-5-later-pass-v1',evidence_event_ids:['failure','pass']});
 });
 it('cites failure, patch and pass in the full fixture',async()=>{
  expect((await localReplay()).edges[0]).toMatchObject({src:'pass',dst:'patch',provenance:'inferred',evidence_event_ids:['failure','patch','pass']});
 });
 it('rejects unrelated files, an absent patch and a pass before failure',async()=>{
  const {events}=await localReplay();
  expect(linkTracer(events.filter(e=>e.id!=='patch'))).toEqual([]);
  expect(linkTracer(events.map(e=>e.id==='pass'?{...e,payload:{...e.payload,files:['other.js']}}:e))).toEqual([]);
  expect(linkTracer(events.map(e=>e.id==='pass'?{...e,ts:'2026-10-25T00:00:00Z'}:e))).toEqual([]);
 });
 it('client entry has no server credential name or public secret variable',async()=>{
  const source=await readFile('apps/web/replay/page.tsx','utf8');
  expect(source).not.toContain('SUPABASE_SECRET_KEY');
  expect(source).not.toMatch(/NEXT_PUBLIC_\w*SECRET/);
 });
});
