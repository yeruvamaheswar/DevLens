// Coding-agent usage for the golden take. Context only: numbers and ids, never text.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UsageRecord } from './event';

export const PRICE_TABLE = 'claude-pricing-2026-10-27';
export const PRICE_TABLE_DATE = '2026-10-27';
// USD per million tokens.
export const PRICES: Record<string, { input: number; write_5m: number; write_1h: number; read: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, write_5m: 2.5, write_1h: 4, read: 0.1, output: 10 },
};

export type UsageTotals = {
  requests: number; models: string[];
  input_tokens: number; output_tokens: number;
  cache_write_5m: number; cache_write_1h: number; cache_read: number;
  list_price_usd: number;
};

export function listPrice(model: string, t: { input_tokens: number; output_tokens: number; cache_write_5m: number; cache_write_1h: number; cache_read: number }): number {
  const p = PRICES[model];
  if (!p) return 0;
  const usd = (t.input_tokens * p.input + t.output_tokens * p.output + t.cache_write_5m * p.write_5m + t.cache_write_1h * p.write_1h + t.cache_read * p.read) / 1e6;
  return Math.round(usd * 1e9) / 1e9;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// One record per request. Lines with the same requestId (fallback message.id) are one request; the last line wins.
export function usageFromTranscript(sessionId: string, text: string): UsageRecord[] {
  const byRequest = new Map<string, UsageRecord>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    const usage = row?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const key = row.requestId ?? row.message?.id;
    if (typeof key !== 'string') continue;
    const model = typeof row.message.model === 'string' ? row.message.model : 'unknown';
    const counts = {
      input_tokens: num(usage.input_tokens),
      output_tokens: num(usage.output_tokens),
      cache_write_5m: num(usage.cache_creation?.ephemeral_5m_input_tokens),
      cache_write_1h: num(usage.cache_creation?.ephemeral_1h_input_tokens),
      cache_read: num(usage.cache_read_input_tokens),
    };
    byRequest.set(key, { session_id: sessionId, request_id: key, model, ...counts, list_price_usd: listPrice(model, counts), price_table: PRICE_TABLE, billing_route: 'plan' });
  }
  return [...byRequest.values()];
}

export function sumUsage(records: readonly UsageRecord[]): UsageTotals {
  const total: UsageTotals = { requests: records.length, models: [], input_tokens: 0, output_tokens: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, list_price_usd: 0 };
  for (const r of records) {
    if (!total.models.includes(r.model)) total.models.push(r.model);
    total.input_tokens += r.input_tokens;
    total.output_tokens += r.output_tokens;
    total.cache_write_5m += r.cache_write_5m;
    total.cache_write_1h += r.cache_write_1h;
    total.cache_read += r.cache_read;
    total.list_price_usd += r.list_price_usd;
  }
  total.list_price_usd = Math.round(total.list_price_usd * 1e9) / 1e9;
  return total;
}

// Missing file means no usage. A malformed line throws.
export async function loadUsage(file: string): Promise<UsageRecord[]> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as UsageRecord);
}

export const GOLDEN_SESSIONS = ['ec6f600a-3902-459e-8769-3c13e7361948', '44a60462-1d30-4fa3-8c72-dbc789421a38'];

async function findTranscript(sessionId: string): Promise<string> {
  const root = path.join(os.homedir(), '.claude', 'projects');
  for (const dir of await readdir(root)) {
    const file = path.join(root, dir, `${sessionId}.jsonl`);
    try { await readFile(file, 'utf8'); return file; } catch { /* keep looking */ }
  }
  throw new Error(`Transcript for ${sessionId} not found`);
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : await Promise.all(GOLDEN_SESSIONS.map(findTranscript));
  const records: UsageRecord[] = [];
  for (const file of files) records.push(...usageFromTranscript(path.basename(file, '.jsonl'), await readFile(file, 'utf8')));
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/broken-api/fixtures/golden/usage.jsonl');
  await writeFile(out, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const t = sumUsage(records);
  console.log(`Wrote ${records.length} requests to ${out}. Input ${t.input_tokens}, output ${t.output_tokens}, write 1h ${t.cache_write_1h}, write 5m ${t.cache_write_5m}, read ${t.cache_read}, list price $${t.list_price_usd.toFixed(4)}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
