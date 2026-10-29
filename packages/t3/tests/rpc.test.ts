// The RPC reader against a fake T3 server: real HTTP and real WebSocket frames on loopback, no T3 install needed.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapThread } from '../src/map';
import { assertReadOnly, exchangePairingToken, mintRpcTicket, readThreadViaRpc, rpcUrl, T3RpcClient, T3RpcError, T3RpcForbiddenMethodError } from '../src/rpc';
import { readThread } from '../src/store';

const TOKEN = 'test-access-token';
const TICKET = 'test-ws-ticket';
const THREAD = 'thread-1';
const NOW = new Date('2026-01-01T00:00:00Z');

// Domain objects as T3 stores them in payload_json and sends them over RPC.
const project = { id: 'project-1', title: 'demo', workspaceRoot: '/work/demo', scripts: [], defaultModelSelection: null, createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z' };
const thread = { id: THREAD, projectId: 'project-1', title: 'Add tests', branch: 'main', worktreePath: null, createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:05:00.000Z' };
const runRow = {
  id: 'run-1', threadId: THREAD, ordinal: 1, providerInstanceId: 'claudeAgent', modelSelection: { instanceId: 'claudeAgent', model: 'claude-sonnet-5-5' }, providerThreadId: 'pt-1',
  status: 'completed', requestedAt: '2026-10-29T10:00:01.000Z', startedAt: '2026-10-29T10:00:02.000Z', completedAt: '2026-10-29T10:04:00.000Z',
};
const base = (id: string, ordinal: number, type: string) => ({
  id, threadId: THREAD, runId: 'run-1', ordinal, type, status: 'completed', title: null, nativeItemRef: { driver: 'claudeAgent', nativeId: `native-${id}` },
  startedAt: `2026-10-29T10:0${ordinal}:00.000Z`, completedAt: `2026-10-29T10:0${ordinal}:30.000Z`, updatedAt: `2026-10-29T10:0${ordinal}:30.000Z`,
});
const items = [
  { ...base('item-1', 1, 'user_message'), createdBy: 'user', messageId: 'm-1', text: 'Add a test for the parser.' },
  { ...base('item-2', 2, 'file_change'), fileName: 'src/parse.test.ts', diffStr: '--- a/src/parse.test.ts\n+++ b/src/parse.test.ts\n@@ -0,0 +1 @@\n+test("parses", () => {});\n' },
  { ...base('item-3', 3, 'command_execution'), input: 'npm test', output: ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n', exitCode: 0 },
];
const checkpoint = { id: 'cp-1', threadId: THREAD, runId: 'run-1', ref: 'refs/t3/checkpoints/1', status: 'ready', files: [{ path: 'src/parse.test.ts', kind: 'added', additions: 1, deletions: 0 }], capturedAt: '2026-10-29T10:04:01.000Z' };

// What T3 sends in a thread snapshot: command output and diffs are trimmed, as projectTurnItemForWire does.
function wireItem(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type === 'command_execution') {
    const { output: _output, ...rest } = item;
    return { ...rest, outputOmitted: true };
  }
  if (item.type === 'file_change') {
    const { diffStr: _diff, ...rest } = item;
    return rest;
  }
  return item;
}

// ---- A minimal RFC 6455 server: text frames, ping, close. ----
function frame(text: string): Buffer {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : body.length < 65536 ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255]) : Buffer.concat([Buffer.from([0x81, 127]), Buffer.alloc(8)]);
  if (body.length >= 65536) head.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([head, body]);
}

function readFrames(socket: Socket, onText: (text: string) => void): void {
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15;
      let length = buffer[1] & 127;
      let offset = 2;
      if (length === 126) [length, offset] = [buffer.readUInt16BE(2), 4];
      else if (length === 127) [length, offset] = [Number(buffer.readBigUInt64BE(2)), 10];
      const masked = (buffer[1] & 128) !== 0;
      const total = offset + (masked ? 4 : 0) + length;
      if (buffer.length < total) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const body = Buffer.from(buffer.subarray(total - length, total));
      if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      buffer = buffer.subarray(total);
      if (opcode === 1) onText(body.toString());
      else if (opcode === 8) socket.end(Buffer.from([0x88, 0]));
    }
  });
}

type Seen = { tags: string[]; interrupts: string[]; acks: string[]; pongs: number; upgrades: string[] };

function fakeT3(seen: Seen): Server {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.method === 'GET' && request.url === '/.well-known/t3/environment') return send(200, { databaseMigration: 72, orchestrationProtocolVersion: 2 });
      if (request.method === 'POST' && request.url === '/api/auth/websocket-ticket/rpc') {
        return request.headers.authorization === `Bearer ${TOKEN}` ? send(200, { ticket: TICKET, expiresAt: '2026-10-29T12:00:00.000Z' }) : send(401, { code: 'invalid_credential', reason: 'invalid_credential' });
      }
      if (request.method === 'POST' && request.url === '/oauth/token') {
        const form = new URLSearchParams(body);
        if (form.get('subject_token') !== 'pairing-1' || form.get('scope') !== 'orchestration:read') return send(400, { code: 'invalid_request' });
        return send(200, { access_token: TOKEN, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 2592000, scope: 'orchestration:read' });
      }
      send(404, {});
    });
  });
  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    seen.upgrades.push(url.pathname + url.search);
    if (url.pathname !== '/ws' || url.searchParams.get('orchestrationProtocol') !== '2' || url.searchParams.get('wsTicket') !== TICKET) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const out = (message: unknown) => socket.write(frame(JSON.stringify(message)));
    out({ _tag: 'Ping' });
    readFrames(socket, (text) => {
      const message = JSON.parse(text) as Record<string, unknown>;
      if (message._tag === 'Pong') seen.pongs++;
      if (message._tag === 'Interrupt') seen.interrupts.push(String(message.requestId));
      if (message._tag === 'Ack') seen.acks.push(String(message.requestId));
      if (message._tag !== 'Request') return;
      const id = String(message.id);
      const tag = String(message.tag);
      const payload = message.payload as Record<string, unknown>;
      seen.tags.push(tag);
      if (tag === 'orchestration.subscribeThread') {
        // A non-snapshot item first, to prove the client skips it and acks.
        out({ _tag: 'Chunk', requestId: id, values: [{ kind: 'synchronized' }] });
        out([{ _tag: 'Chunk', requestId: id, values: [{ kind: 'snapshot', snapshotSequence: 7, projection: { thread, runs: [runRow], turnItems: items.map(wireItem), checkpoints: [checkpoint], messages: [], updatedAt: thread.updatedAt } }] }]);
      } else if (tag === 'orchestration.subscribeShell') {
        out({ _tag: 'Chunk', requestId: id, values: [{ kind: 'snapshot', snapshot: { projects: [project], threads: [] } }] });
      } else if (tag === 'orchestration.getTurnItem') {
        const found = items.find((item) => item.id === payload.itemId);
        if (found) out({ _tag: 'Exit', requestId: id, exit: { _tag: 'Success', value: { item: found } } });
        else out({ _tag: 'Exit', requestId: id, exit: { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'OrchestrationV2GetThreadProjectionError', message: 'Failed to load turn item' } }] } });
      }
    });
  });
  return server;
}

// The same rows in a temporary database, the way T3 stores them, for the SQLite side of the comparison.
function sqliteSnapshot(dir: string) {
  const db = new DatabaseSync(path.join(dir, 'state.sqlite'));
  db.exec(`
    CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT, title TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, provider TEXT, provider_thread_id TEXT, status TEXT, requested_at TEXT, completed_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, ordinal INTEGER, type TEXT, status TEXT, updated_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_checkpoints (checkpoint_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT, status TEXT, captured_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, stream_id TEXT, event_type TEXT, occurred_at TEXT, payload_json TEXT);
    INSERT INTO effect_sql_migrations VALUES (72, 'checked');
  `);
  db.prepare('INSERT INTO orchestration_events (event_id, event_type, occurred_at, payload_json) VALUES (?, ?, ?, ?)').run('e1', 'project.created', project.createdAt, JSON.stringify({ projectId: project.id, title: project.title, workspaceRoot: project.workspaceRoot }));
  db.prepare('INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, ?, ?, ?, NULL, ?)').run(THREAD, thread.projectId, thread.title, thread.createdAt, thread.updatedAt, JSON.stringify(thread));
  db.prepare('INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(runRow.id, THREAD, runRow.ordinal, runRow.providerInstanceId, runRow.providerThreadId, runRow.status, runRow.requestedAt, runRow.completedAt, JSON.stringify(runRow));
  for (const item of items) db.prepare('INSERT INTO orchestration_v2_projection_turn_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(item.id, THREAD, item.runId, item.ordinal, item.type, item.status, item.updatedAt, JSON.stringify(item));
  db.prepare('INSERT INTO orchestration_v2_projection_checkpoints VALUES (?, ?, ?, ?, ?, ?)').run(checkpoint.id, THREAD, checkpoint.runId, checkpoint.status, checkpoint.capturedAt, JSON.stringify(checkpoint));
  const snapshot = readThread(db, THREAD);
  db.close();
  return snapshot;
}

describe('T3 RPC reader (fake server)', () => {
  const seen: Seen = { tags: [], interrupts: [], acks: [], pongs: 0, upgrades: [] };
  const server = fakeT3(seen);
  const dir = mkdtempSync(path.join(tmpdir(), 'devlens-t3-rpc-'));
  let origin = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('NOT-2: blocks every method that is not on the read-only allowlist, before sending', async () => {
    for (const method of ['orchestration.dispatchCommand', 'orchestration.launchThread', 'orchestration.stopWorkflow', 'projects.mutate', 'server.refreshProviders', 'orchestration.getThreadProjectionX']) {
      expect(() => assertReadOnly(method)).toThrow(T3RpcForbiddenMethodError);
    }
    expect(() => assertReadOnly('orchestration.subscribeThread')).not.toThrow();
    const before = seen.tags.length;
    const client = await T3RpcClient.connect(rpcUrl(origin, await mintRpcTicket(origin, TOKEN)));
    await expect(client.request('orchestration.dispatchCommand', { type: 'thread.delete', threadId: THREAD })).rejects.toBeInstanceOf(T3RpcForbiddenMethodError);
    await expect(client.request('orchestration.getTurnItem', { threadId: THREAD, itemId: 'missing' })).rejects.toThrow('Failed to load turn item');
    client.close();
    expect(seen.tags.slice(before)).toEqual(['orchestration.getTurnItem']);
  });

  it('EVAL-7 (offline): the RPC snapshot maps to the same events as the SQLite snapshot of the same rows', async () => {
    const before = { tags: seen.tags.length, interrupts: seen.interrupts.length };
    const rpc = await readThreadViaRpc(THREAD, { origin, accessToken: TOKEN, timeoutMs: 5000 });
    const local = sqliteSnapshot(dir);

    // Full bodies came back through getTurnItem, so trimmed command output and diffs are restored.
    expect(rpc.items.find((item) => item.type === 'command_execution')?.payload.output).toContain('1 passed');
    expect(rpc.items.find((item) => item.type === 'file_change')?.payload.diffStr).toContain('parses');
    expect(rpc.project).toEqual(local.project);
    expect(rpc.migration).toBe(72);

    const a = mapThread(local, { now: NOW });
    const b = mapThread(rpc, { now: NOW });
    expect(b.events.map((event) => event.id)).toEqual(a.events.map((event) => event.id));
    expect(b.events).toEqual(a.events);
    expect(b.events.map((event) => event.type)).toEqual(['prompt', 'file_edit', 'test', 'checkpoint']);

    // Only read-only methods went out; both streams were interrupted after the snapshot; the ping got a pong.
    const tags = seen.tags.slice(before.tags);
    expect(new Set(tags)).toEqual(new Set(['orchestration.subscribeThread', 'orchestration.subscribeShell', 'orchestration.getTurnItem']));
    expect(tags.filter((tag) => tag === 'orchestration.getTurnItem')).toHaveLength(2);
    expect(seen.interrupts.length - before.interrupts).toBe(2);
    expect(seen.acks.length).toBeGreaterThan(0);
    expect(seen.pongs).toBeGreaterThan(0);
    expect(seen.upgrades.at(-1)).toBe(`/ws?orchestrationProtocol=2&wsTicket=${TICKET}`);
  });

  it('pairing: trades a one-time token for a read-only bearer token', async () => {
    await expect(exchangePairingToken(origin, 'pairing-1')).resolves.toEqual({ accessToken: TOKEN, scope: 'orchestration:read', expiresIn: 2592000 });
    await expect(exchangePairingToken(origin, 'wrong')).rejects.toThrow('HTTP 400');
  });

  it('a bad access token fails at the ticket step with the HTTP status, not later', async () => {
    await expect(readThreadViaRpc(THREAD, { origin, accessToken: 'nope', timeoutMs: 5000 })).rejects.toThrow(T3RpcError);
    await expect(mintRpcTicket(origin, 'nope')).rejects.toThrow('HTTP 401 (invalid_credential)');
  });
});

describe('slice 4 review fix 1: tokens go only to the local T3 server', async () => {
  const rpcModule = await import('../src/rpc');
  it('refuses a non-loopback origin before any request', async () => {
    for (const origin of ['http://evil.example', 'https://10.0.0.5:3773', 'http://127.0.0.1.evil.example']) {
      expect(() => rpcModule.assertLocalOrigin(origin), origin).toThrow(/only the local T3 server/);
      await expect(rpcModule.mintRpcTicket(origin, 'token-not-sent')).rejects.toThrow(/only the local T3 server/);
      await expect(rpcModule.readThreadViaRpc('t1', { origin, accessToken: 'token-not-sent' })).rejects.toThrow(/only the local T3 server/);
    }
    for (const origin of ['http://127.0.0.1:3773', 'http://localhost:3773', 'http://[::1]:3773']) expect(() => rpcModule.assertLocalOrigin(origin), origin).not.toThrow();
  });
});
