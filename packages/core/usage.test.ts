import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SESSIONS, PRICE_TABLE, loadUsage, sumUsage, usageFromTranscript } from './usage';

function line(requestId: string, out: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    requestId,
    message: { id: `msg_${requestId}`, model: 'claude-sonnet-5-5', content: 'secret text', usage: { input_tokens: 2, output_tokens: out, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 500 } } },
    ...extra,
  });
}

describe('usage totals', () => {
  it('sums deduped requests and prices them from the table', () => {
    const text = [line('r1', 10), line('r1', 50), line('r2', 100), '{"type":"user"}', 'not json'].join('\n');
    const records = usageFromTranscript('s1', text);
    expect(records).toHaveLength(2);
    const t = sumUsage(records);
    expect(t).toMatchObject({ requests: 2, models: ['claude-sonnet-5-5'], input_tokens: 4, output_tokens: 150, cache_write_5m: 0, cache_write_1h: 1000, cache_read: 2000 });
    // (4*2 + 150*10 + 1000*4 + 2000*0.1) / 1e6
    expect(t.list_price_usd).toBeCloseTo(0.005708, 9);
    expect(records[0].price_table).toBe(PRICE_TABLE);
    expect(records[0].billing_route).toBe('plan');
  });

  it('keeps no message text in a record', () => {
    expect(JSON.stringify(usageFromTranscript('s1', line('r1', 5)))).not.toContain('secret');
  });

  it('reads the committed golden usage file', async () => {
    const t = sumUsage(await loadUsage('examples/broken-api/fixtures/golden/usage.jsonl'));
    expect(t).toMatchObject({ requests: 11, models: ['claude-sonnet-5-5'], input_tokens: 22, output_tokens: 2434, cache_write_1h: 82753, cache_write_5m: 0, cache_read: 664323 });
    expect(t.list_price_usd).toBeCloseTo(0.4218, 4);
  });

  it('returns nothing for a missing file', async () => {
    expect(await loadUsage('examples/broken-api/fixtures/golden/none.jsonl')).toEqual([]);
  });

  const projects = path.join(os.homedir(), '.claude', 'projects');
  it('reproduces the totals from the real transcripts when present', async (ctx) => {
    const { readdirSync } = await import('node:fs');
    const files: string[] = [];
    if (existsSync(projects)) {
      for (const dir of readdirSync(projects)) for (const id of GOLDEN_SESSIONS) {
        const file = path.join(projects, dir, `${id}.jsonl`);
        if (existsSync(file)) files.push(file);
      }
    }
    if (files.length !== GOLDEN_SESSIONS.length) return ctx.skip();
    const records = (await Promise.all(files.map(async (f) => usageFromTranscript(path.basename(f, '.jsonl'), await readFile(f, 'utf8'))))).flat();
    expect(sumUsage(records)).toMatchObject({ requests: 11, input_tokens: 22, output_tokens: 2434, cache_write_1h: 82753, cache_write_5m: 0, cache_read: 664323 });
  });
});
