import type { Event, Edge } from '../../core/event';
// Fixed rule 5. No model calls. A pass must explicitly name its patch and files.
export function linkTracer(input: Event[]): Edge[] {
  const events = [...input].sort((a,b) => a.ts.localeCompare(b.ts) || a.seq-b.seq);
  const edges: Edge[] = [];
  for (const pass of events) {
    if (pass.type !== 'test' || pass.payload.status !== 'passed') continue;
    if (typeof pass.payload.command !== 'string' || !/(^|[\s/])(npm test|vitest|pytest)([\s]|$)/.test(pass.payload.command)) continue;
    const patch = events.find(e => e.id === pass.payload.patch_event_id && e.type === 'file_edit' && events.indexOf(e) < events.indexOf(pass));
    const failure = events.slice(0, events.indexOf(pass)).findLast(e => e.type === 'test' && e.payload.status === 'failed' && e.payload.command === pass.payload.command && JSON.stringify(e.payload.files) === JSON.stringify(pass.payload.files));
    if (!failure) continue;
    if (pass.payload.patch_event_id && !patch) continue;
    if (patch && JSON.stringify(patch.payload.files) !== JSON.stringify(pass.payload.files)) continue;
    // Two-test fixtures may link a later pass directly to the failure when no patch is claimed.
    edges.push({id:`edge_${pass.id}`,src:pass.id,dst:patch?.id ?? failure.id,rel:'verifies',derived_by:'rule-5-later-pass-v1',provenance:'inferred',evidence_event_ids:[failure.id,...(patch ? [patch.id] : []),pass.id]});
  }
  return edges;
}
