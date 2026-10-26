import { describe, expect, it } from 'vitest';
import type { Event } from '../../core/event';
import { RULE_LATER_PASS, isUnattributedEdit, linkEvents } from '../src/rules';
import { LinkWriteError, planSession, writeSessions, type RpcClient } from '../../cli/src/link';

function ev(partial: Partial<Event> & Pick<Event, 'id' | 'type' | 'ts' | 'seq'>): Event {
  return {
    session_id: 'ses',
    project_id: 'broken-api',
    actor: 'agent',
    source: 'claude_code_hook',
    provenance: 'observed',
    recording_ref: null,
    media_offset_ms: null,
    payload: {},
    ...partial,
  };
}

function verifies(events: Event[]) {
  return linkEvents(events).find((edge) => edge.rel === 'verifies');
}

describe('link rules', () => {
  // Changed for review finding F5: a bare fail/pass pair (no edit between) no longer verifies.
  // The hand-written JSONL is now a fail/edit/pass triple and verifies the edit.
  it('emits a verifies edge with derived_by for a hand-written fail/edit/pass JSONL', () => {
    const jsonl = [
      JSON.stringify(ev({ id: 'failure', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, actor: 'tool', payload: { status: 'failed', command: 'npm test', output: 'wrong base URL' } })),
      JSON.stringify(ev({ id: 'patch', type: 'file_edit', ts: '2026-10-26T15:00:02.000Z', seq: 2, payload: { files: ['client.js'] } })),
      JSON.stringify(ev({ id: 'pass', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 3, actor: 'tool', payload: { status: 'passed', command: 'npm test', output: 'ok' } })),
    ].join('\n');
    const events = jsonl.split('\n').map((line) => JSON.parse(line) as Event);
    const edge = verifies(events);
    expect(edge).toMatchObject({
      id: `${RULE_LATER_PASS}:pass:patch`,
      src: 'pass',
      dst: 'patch',
      rel: 'verifies',
      derived_by: RULE_LATER_PASS,
      provenance: 'inferred',
      evidence_event_ids: ['failure', 'patch', 'pass'],
    });
    expect(edge?.derived_by.length).toBeGreaterThan(0);
    expect(events.map((event) => event.id)).toEqual(expect.arrayContaining(edge?.evidence_event_ids ?? []));
  });

  it('F5: a pass after a failure with no edit between produces no verifies', () => {
    const events = [
      ev({ id: 'f', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, payload: { status: 'failed', command: 'npm test', output: '' } }),
      ev({ id: 'p', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 2, payload: { status: 'passed', command: 'npm test', output: '' } }),
    ];
    expect(linkEvents(events).some((edge) => edge.rel === 'verifies')).toBe(false);
  });

  it('F6: never links across sessions', () => {
    const events = [
      ev({ id: 'f', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, payload: { status: 'failed', command: 'npm test', output: '' } }),
      ev({ id: 'a', session_id: 'other', type: 'file_edit', ts: '2026-10-26T15:00:01.000Z', seq: 1, payload: { files: ['x.js'] } }),
      ev({ id: 'p', type: 'test', ts: '2026-10-26T15:00:02.000Z', seq: 2, payload: { status: 'passed', command: 'npm test', output: '' } }),
      ev({ id: 'prompt', session_id: 'other', type: 'prompt', ts: '2026-10-26T14:59:00.000Z', seq: 0, actor: 'developer', payload: {} }),
    ];
    const bySession = new Map(events.map((event) => [event.id, event.session_id]));
    const edges = linkEvents(events);
    for (const edge of edges) {
      expect(bySession.get(edge.src)).toBe(bySession.get(edge.dst));
      for (const id of edge.evidence_event_ids) expect(bySession.get(id)).toBe(bySession.get(edge.src));
    }
    expect(edges.some((edge) => edge.rel === 'verifies')).toBe(false);
  });

  it('F1/F7: duplicate ids collapse and never produce a self-edge', () => {
    const edit = ev({ id: 'a', type: 'file_edit', ts: '2026-10-26T15:00:01.000Z', seq: 2, payload: { files: ['client.js'] } });
    const events = [
      ev({ id: 'f', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, payload: { status: 'failed', command: 'npm test', output: '' } }),
      edit,
      { ...edit },
      ev({ id: 'p', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 4, payload: { status: 'passed', command: 'npm test', output: '' } }),
    ];
    const edges = linkEvents(events);
    expect(edges.some((edge) => edge.src === edge.dst)).toBe(false);
    expect(edges.some((edge) => edge.rel === 'supersedes')).toBe(false);
    expect(edges).toEqual(linkEvents([events[0], edit, events[3]]));
  });

  it('F1: conflicting payloads under one id are rejected', () => {
    const base = ev({ id: 'a', type: 'file_edit', ts: '2026-10-26T15:00:01.000Z', seq: 2, payload: { files: ['client.js'] } });
    expect(() => linkEvents([base, { ...base, payload: { files: ['other.js'] } }])).toThrow(/different content/);
  });

  it('links a later pass to the last edit and supersedes the first', () => {
    const events = [
      ev({ id: 'fail-1', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, payload: { status: 'failed', command: 'npm test', output: 'fail 1' } }),
      ev({ id: 'edit-1', type: 'file_edit', ts: '2026-10-26T15:00:01.000Z', seq: 2, payload: { files: ['client.js'], diff: '+ /api' } }),
      ev({ id: 'fail-2', type: 'test', ts: '2026-10-26T15:00:02.000Z', seq: 3, payload: { status: 'failed', command: 'npm test', output: 'fail 2' } }),
      ev({ id: 'edit-2', type: 'file_edit', ts: '2026-10-26T15:00:03.000Z', seq: 4, payload: { files: ['client.js'], diff: '+ token' } }),
      ev({ id: 'pass', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 5, payload: { status: 'passed', command: 'npm test', output: 'ok' } }),
    ];
    const edges = linkEvents(events);
    expect(edges.find((edge) => edge.rel === 'verifies')).toMatchObject({
      src: 'pass',
      dst: 'edit-2',
      derived_by: RULE_LATER_PASS,
      provenance: 'inferred',
    });
    expect(edges.find((edge) => edge.rel === 'supersedes')).toMatchObject({
      src: 'edit-2',
      dst: 'edit-1',
      derived_by: RULE_LATER_PASS,
    });
    const ids = new Set(events.map((event) => event.id));
    for (const edge of edges) {
      expect(edge.id).toBe(`${edge.derived_by}:${edge.src}:${edge.dst}`);
      expect(edge.evidence_event_ids.every((id) => ids.has(id))).toBe(true);
    }
    expect(edges.map((edge) => edge.id)).toEqual([...edges.map((edge) => edge.id)].sort());
  });

  it('does not treat an unknown-status test as a pass', () => {
    const unknown = ev({ id: 'unknown-test', type: 'test', ts: '2026-10-26T15:00:02.000Z', seq: 3, payload: { status: 'unknown', command: 'npm test', output: '' } });
    const events = [
      ev({ id: 'fail-1', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, payload: { status: 'failed', command: 'npm test', output: 'fail' } }),
      ev({ id: 'edit-1', type: 'file_edit', ts: '2026-10-26T15:00:01.000Z', seq: 2, payload: { files: ['client.js'] } }),
      unknown,
    ];
    expect(linkEvents(events).some((edge) => edge.rel === 'verifies')).toBe(false);
    const later = [
      ...events,
      ev({ id: 'pass', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 4, payload: { status: 'passed', command: 'npm test', output: 'ok' } }),
    ];
    expect(verifies(later)).toMatchObject({ src: 'pass', dst: 'edit-1' });
  });

  it('keeps an unhooked edit unattributed', () => {
    const loose: Event = ev({
      id: 'loose',
      type: 'file_edit',
      ts: '2026-10-26T15:00:03.000Z',
      seq: 4,
      actor: 'unknown',
      source: 'git',
      provenance: 'inferred',
      payload: { files: ['client.js'], attribution: 'unattributed' },
    });
    const before = structuredClone(loose);
    const events = [
      ev({ id: 'fail-1', type: 'test', ts: '2026-10-26T15:00:00.000Z', seq: 1, payload: { status: 'failed', command: 'npm test', output: 'fail' } }),
      ev({ id: 'edit-1', type: 'file_edit', ts: '2026-10-26T15:00:01.000Z', seq: 2, payload: { files: ['client.js'] } }),
      loose,
      ev({ id: 'pass', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 5, payload: { status: 'passed', command: 'npm test', output: 'ok' } }),
    ];
    const edges = linkEvents(events);
    expect(loose).toEqual(before);
    expect(isUnattributedEdit(loose)).toBe(true);
    expect(loose.actor).toBe('unknown');
    expect(loose.payload.attribution).toBe('unattributed');
    expect(verifies(events)?.dst).toBe('loose');
    expect(edges.some((edge) => edge.dst === 'loose' && edge.rel === 'prompted')).toBe(false);
    expect(edges.some((edge) => edge.src === 'loose' && edge.rel === 'edited')).toBe(false);
  });

  it('returns the same edges on a second run', () => {
    const events = [
      ev({ id: 'prompt-1', type: 'prompt', ts: '2026-10-26T15:00:00.000Z', seq: 1, actor: 'developer', payload: { hook_event_name: 'UserPromptSubmit' } }),
      ev({ id: 'call-1', type: 'tool_call', ts: '2026-10-26T15:00:01.000Z', seq: 2, tool_use_id: 'toolu_1', payload: { phase: 'pre' } }),
      ev({ id: 'fail-1', type: 'test', ts: '2026-10-26T15:00:02.000Z', seq: 3, tool_use_id: 'toolu_1', payload: { status: 'failed', command: 'npm test', output: 'fail' } }),
      ev({ id: 'edit-1', type: 'file_edit', ts: '2026-10-26T15:00:03.000Z', seq: 4, tool_use_id: 'toolu_2', payload: { files: ['client.js'] } }),
      ev({ id: 'fail-2', type: 'test', ts: '2026-10-26T15:00:04.000Z', seq: 5, tool_use_id: 'toolu_3', payload: { status: 'failed', command: 'npm test', output: 'fail again' } }),
      ev({ id: 'stop-1', type: 'stop', ts: '2026-10-26T15:00:05.000Z', seq: 6, payload: { hook_event_name: 'Stop' } }),
      ev({ id: 'after-stop', type: 'tool_call', ts: '2026-10-26T15:00:06.000Z', seq: 7, payload: { phase: 'pre' } }),
    ];
    const reversed = [...events].reverse();
    expect(linkEvents(events)).toEqual(linkEvents(events));
    expect(linkEvents(reversed)).toEqual(linkEvents(events));
    const edges = linkEvents(events);
    expect(edges.map((edge) => edge.id)).toEqual([...edges.map((edge) => edge.id)].sort());
    expect(edges.some((edge) => edge.rel === 'prompted' && edge.src === 'prompt-1' && edge.dst === 'fail-1' && edge.provenance === 'observed')).toBe(true);
    expect(edges.some((edge) => edge.rel === 'edited' && edge.src === 'edit-1' && edge.dst === 'prompt-1')).toBe(true);
    expect(edges.some((edge) => edge.rel === 'failed' && edge.src === 'fail-2' && edge.dst === 'edit-1')).toBe(true);
    expect(edges.some((edge) => edge.rel === 'prompted' && edge.dst === 'after-stop')).toBe(false);
  });
});

describe('replace_session write path', () => {
  function jsonlEvent(e: Event) { return { event: e, order: 0 }; }
  const mk = (id: string, session: string, ts: string, extra: Partial<Event> = {}) => ev({ id, session_id: session, type: 'file_edit', ts, seq: 99, payload: { files: ['a.js'] }, ...extra });

  function fake(failOn?: string, error: { message?: string; code?: string } = { message: 'boom' }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client: RpcClient = {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (args.p_session_id === failOn) return { data: null, error };
        return { data: { events: (args.p_events as unknown[]).length, edges: (args.p_edges as unknown[]).length }, error: null };
      },
    };
    return { client, calls };
  }

  it('makes one rpc per session with final seq 1..n and no other call', async () => {
    const plan = planSession([
      jsonlEvent(mk('b', 's1', '2026-10-26T15:00:02.000Z')),
      jsonlEvent(mk('a', 's1', '2026-10-26T15:00:01.000Z')),
      jsonlEvent(mk('a', 's1', '2026-10-26T15:00:01.000Z')),
      jsonlEvent(mk('c', 's2', '2026-10-26T15:00:03.000Z')),
    ]);
    const { client, calls } = fake();
    expect(await writeSessions(client, plan.sessions)).toEqual(['s1', 's2']);
    expect(calls.map((c) => c.fn)).toEqual(['replace_session', 'replace_session']);
    const s1 = calls[0].args.p_events as { id: string; seq: number }[];
    expect(s1.map((r) => [r.id, r.seq])).toEqual([['a', 1], ['b', 2]]);
  });

  it('rejects conflicting duplicates before any rpc', () => {
    expect(() => planSession([
      jsonlEvent(mk('a', 's1', '2026-10-26T15:00:01.000Z')),
      jsonlEvent(mk('a', 's1', '2026-10-26T15:00:01.000Z', { payload: { files: ['z.js'] } })),
    ])).toThrow(/different content/);
  });

  it('reports a failing rpc, stops, and names the sessions already replaced', async () => {
    const plan = planSession([jsonlEvent(mk('a', 's1', '2026-10-26T15:00:01.000Z')), jsonlEvent(mk('b', 's2', '2026-10-26T15:00:02.000Z')), jsonlEvent(mk('c', 's3', '2026-10-26T15:00:03.000Z'))]);
    const { client, calls } = fake('s2');
    const error = await writeSessions(client, plan.sessions).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinkWriteError);
    expect((error as LinkWriteError).succeeded).toEqual(['s1']);
    expect((error as Error).message).toContain('Sessions already replaced: s1');
    expect(calls.map((c) => c.args.p_session_id)).toEqual(['s1', 's2']);
  });

  it('gives a clear message when the function is missing', async () => {
    const plan = planSession([jsonlEvent(mk('a', 's1', '2026-10-26T15:00:01.000Z'))]);
    const { client, calls } = fake('s1', { code: 'PGRST202', message: 'Could not find the function public.replace_session' });
    await expect(writeSessions(client, plan.sessions)).rejects.toThrow('replace_session function not found; apply migration 20261026240000');
    expect(calls).toHaveLength(1);
  });
});
