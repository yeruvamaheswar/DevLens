// One real engine call on a SYNTHETIC fixture session. Not real developer data.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Event } from '../../core/event';
import { runAtStop, selectEngine } from './run';

const session = 'synthetic-session-1';
const base = { session_id: session, project_id: 'synthetic-project', recording_ref: null, media_offset_ms: null, provenance: 'observed' as const, source: 'claude_code_hook' as const };
const events: Event[] = [
  { ...base, id: `${session}:UserPromptSubmit:p1`, ts: '2026-01-01T10:00:00.000Z', seq: 1, actor: 'developer', type: 'prompt', payload: { prompt: 'The /orders endpoint returns 500 when the cart is empty. Make it return an empty list.' } },
  { ...base, id: `${session}:tu1:pre`, ts: '2026-01-01T10:00:05.000Z', seq: 2, actor: 'agent', type: 'tool_call', payload: { tool_name: 'Read', phase: 'pre' } },
  { ...base, id: `${session}:tu2:post`, ts: '2026-01-01T10:00:20.000Z', seq: 3, actor: 'agent', type: 'file_edit', payload: { files: ['src/orders.js'], tool_name: 'Edit', diff: '- const total = items.reduce((a, i) => a + i.price)\n+ const total = items.length === 0 ? 0 : items.reduce((a, i) => a + i.price, 0)\n+ if (items.length === 0) return []' } },
  { ...base, id: `${session}:tu3:post`, ts: '2026-01-01T10:00:40.000Z', seq: 4, actor: 'tool', type: 'test', payload: { status: 'passed', command: 'npm test', output: '3 passed', signal: 'output_parse' } },
  { ...base, id: `${session}:Stop:p1`, ts: '2026-01-01T10:00:50.000Z', seq: 5, actor: 'agent', type: 'stop', payload: { hook_event_name: 'Stop', prompt_id: 'p1' } },
];

const dir = mkdtempSync(path.join(tmpdir(), 'devlens-agent-smoke-'));
try {
  mkdirSync(path.join(dir, 'src'));
  mkdirSync(path.join(dir, '.devlens'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'synthetic-orders', scripts: { test: 'node --test' } }));
  writeFileSync(path.join(dir, 'src', 'orders.js'), 'export function orderTotal(items) {\n  if (items.length === 0) return 0;\n  return items.reduce((a, i) => a + i.price, 0);\n}\n');
  writeFileSync(path.join(dir, '.devlens', 'agent.json'), JSON.stringify({ enabled: true }));
  writeFileSync(path.join(dir, '.devlens', 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);

  const engine = selectEngine(process.env);
  console.log(`engine route: ${engine.route}, model: ${engine.model} (synthetic fixture session)`);
  const outcome = await runAtStop({ projectDir: dir, session_id: session, stop_event_id: `${session}:Stop:p1`, engine });
  if (outcome.asked.length > 0) console.log('KEPT question:', JSON.stringify(outcome.asked[0], null, 2));
  else console.log(`SKIPPED: ${outcome.skipped}`);
  console.log('ledger lines:');
  console.log(readFileSync(path.join(dir, '.devlens', 'agent-ledger.jsonl'), 'utf8').trim());
} finally {
  rmSync(dir, { recursive: true, force: true });
}
