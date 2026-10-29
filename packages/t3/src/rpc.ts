// Read-only access to a running T3 Code server through its supported, authenticated RPC API.
// Transport: Effect RPC messages as JSON text frames on the WebSocket at /ws (orchestration protocol 2).
// Auth: a bearer access token from T3's own pairing flow (`t3 pair`), then a short-lived WebSocket ticket per connection.
// NOT-2: DevLens sends only the methods in READ_ONLY_METHODS. Any other method throws before anything is sent.
// Checked against T3 Code server 0.1.5 (orchestration protocol 2, database migration 72) on 2026-10-29.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { T3Checkpoint, T3Item, T3Project, T3Run, T3ThreadSnapshot } from './store';

export const ORCHESTRATION_PROTOCOL = 2;
export const READ_SCOPE = 'orchestration:read';
export const DEFAULT_TOKEN_FILE = path.join(homedir(), '.devlens', 't3-rpc-token');
const RUNTIME_FILE = path.join(homedir(), '.t3', 'userdata', 'server-runtime.json');
const DEFAULT_ORIGIN = 'http://127.0.0.1:3773';

// The only RPC methods DevLens may send. All three read; none creates, changes, or deletes anything in T3.
// T3's `orchestration:read` scope alone is not enough: it also allows calls such as `server.refreshProviders`.
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set(['orchestration.subscribeThread', 'orchestration.subscribeShell', 'orchestration.getTurnItem']);

// T3 trims these item types on the wire (command output, diffs, long tool bodies). getTurnItem returns the stored item.
const TRIMMED_ON_WIRE = new Set(['command_execution', 'file_change', 'dynamic_tool', 'subagent', 'handoff']);
const BODY_CONCURRENCY = 8;

export class T3RpcForbiddenMethodError extends Error {}
export class T3RpcError extends Error {}

export function assertReadOnly(method: string): void {
  if (!READ_ONLY_METHODS.has(method)) throw new T3RpcForbiddenMethodError(`T3 RPC method ${method} is not on DevLens's read-only allowlist. Nothing was sent.`);
}

type Json = Record<string, unknown>;
type Pending = {
  method: string;
  accept: ((value: unknown) => boolean) | null; // null: a unary call that ends with Exit
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// An encoded Effect failure carries a cause list. Show the first readable message.
function failureMessage(exit: Json): string {
  const causes = Array.isArray(exit.cause) ? exit.cause.map(record) : [];
  for (const cause of causes) {
    const error = record(cause.error);
    const text = str(error.message) ?? str(error._tag) ?? str(record(cause.defect).message) ?? (typeof cause.defect === 'string' ? cause.defect : null);
    if (text) return text;
  }
  return JSON.stringify(exit).slice(0, 300);
}

// One WebSocket connection. Requests carry string ids; a stream is read until the first wanted value, then interrupted.
export class T3RpcClient {
  #socket: WebSocket;
  #next = 1;
  #pending = new Map<string, Pending>();
  #timeoutMs: number;
  #closed = false;

  private constructor(socket: WebSocket, timeoutMs: number) {
    this.#socket = socket;
    this.#timeoutMs = timeoutMs;
    socket.addEventListener('message', (event) => this.#onMessage(String(event.data)));
    socket.addEventListener('close', () => this.#failAll(new T3RpcError('T3 closed the RPC connection.')));
    socket.addEventListener('error', () => this.#failAll(new T3RpcError('T3 RPC connection error.')));
  }

  static connect(url: string, timeoutMs = 30_000): Promise<T3RpcClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new T3RpcError(`T3 RPC connection timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new T3RpcClient(socket, timeoutMs));
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new T3RpcError('Could not open the T3 RPC connection. Is T3 Code running, and is the ticket valid?'));
      });
    });
  }

  // Unary call: resolves with the Exit value.
  request<T>(method: string, payload: Json): Promise<T> {
    return this.#start(method, payload, null) as Promise<T>;
  }

  // Stream call: resolves with the first chunk value that `accept` takes, then interrupts the stream.
  first<T>(method: string, payload: Json, accept: (value: unknown) => boolean): Promise<T> {
    return this.#start(method, payload, accept) as Promise<T>;
  }

  close(): void {
    this.#closed = true;
    this.#failAll(new T3RpcError('T3 RPC client closed.'));
    this.#socket.close();
  }

  #start(method: string, payload: Json, accept: Pending['accept']): Promise<unknown> {
    try {
      assertReadOnly(method); // NOT-2: before any id is taken or any byte is sent.
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.#closed) return Promise.reject(new T3RpcError('T3 RPC client is closed.'));
    const id = String(this.#next++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#settle(id, new T3RpcError(`T3 RPC ${method} timed out after ${this.#timeoutMs} ms.`)), this.#timeoutMs);
      this.#pending.set(id, { method, accept, resolve, reject, timer });
      this.#send({ _tag: 'Request', id, tag: method, payload, headers: [] });
    });
  }

  #send(message: Json): void {
    this.#socket.send(JSON.stringify(message));
  }

  #settle(id: string, outcome: Error | { value: unknown }): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (outcome instanceof Error) pending.reject(outcome);
    else pending.resolve(outcome.value);
  }

  #failAll(error: Error): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, error);
  }

  #onMessage(text: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      this.#failAll(new T3RpcError('T3 sent a frame that is not JSON.'));
      return;
    }
    for (const message of (Array.isArray(decoded) ? decoded : [decoded]).map(record)) this.#handle(message);
  }

  #handle(message: Json): void {
    const id = message.requestId == null ? null : String(message.requestId);
    if (message._tag === 'Ping') this.#send({ _tag: 'Pong' });
    else if (message._tag === 'Defect') this.#failAll(new T3RpcError(`T3 RPC defect: ${JSON.stringify(message.defect).slice(0, 300)}`));
    else if (message._tag === 'Chunk' && id) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      const values = Array.isArray(message.values) ? message.values : [];
      const hit = pending.accept ? values.find((value) => pending.accept!(value)) : undefined;
      if (hit !== undefined) {
        this.#settle(id, { value: hit });
        this.#send({ _tag: 'Interrupt', requestId: id });
      } else this.#send({ _tag: 'Ack', requestId: id });
    } else if (message._tag === 'Exit' && id) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      const exit = record(message.exit);
      if (exit._tag === 'Success' && pending.accept == null) this.#settle(id, { value: exit.value });
      else if (exit._tag === 'Success') this.#settle(id, new T3RpcError(`T3 RPC ${pending.method} ended before the expected value.`));
      else this.#settle(id, new T3RpcError(`T3 RPC ${pending.method} failed: ${failureMessage(exit)}`));
    }
  }
}

// ---- Auth (HTTP). These are T3's documented pairing endpoints, not RPC methods. ----

export function defaultOrigin(): string {
  try {
    const runtime = record(JSON.parse(readFileSync(RUNTIME_FILE, 'utf8')));
    return str(runtime.origin) ?? DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

async function postJson(url: string, init: RequestInit, what: string): Promise<Json> {
  const response = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(15_000) });
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok) throw new T3RpcError(`${what} failed with HTTP ${response.status}${str(body.code) ? ` (${body.code})` : ''}${str(body.reason) ? `: ${body.reason}` : ''}.`);
  return body;
}

// Trades a one-time pairing token from `t3 pair` for a bearer access token limited to orchestration:read.
// T3 records this as a client session that the user can revoke in T3's connections list.
export async function exchangePairingToken(origin: string, pairingToken: string, label = 'DevLens (read-only)'): Promise<{ accessToken: string; scope: string; expiresIn: number }> {
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: pairingToken,
    subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: READ_SCOPE,
    client_label: label,
    client_device_type: 'bot',
  });
  const body = await postJson(new URL('/oauth/token', origin).href, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }, 'T3 pairing token exchange');
  const accessToken = str(body.access_token);
  if (!accessToken) throw new T3RpcError('T3 pairing token exchange returned no access token.');
  return { accessToken, scope: str(body.scope) ?? '', expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 0 };
}

export async function mintRpcTicket(origin: string, accessToken: string): Promise<string> {
  const body = await postJson(new URL('/api/auth/websocket-ticket/rpc', origin).href, { headers: { authorization: `Bearer ${accessToken}` } }, 'T3 WebSocket ticket');
  const ticket = str(body.ticket);
  if (!ticket) throw new T3RpcError('T3 returned no WebSocket ticket.');
  return ticket;
}

export function rpcUrl(origin: string, ticket: string): string {
  const url = new URL('/ws', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('orchestrationProtocol', String(ORCHESTRATION_PROTOCOL));
  url.searchParams.set('wsTicket', ticket);
  return url.href;
}

async function databaseMigration(origin: string): Promise<number | null> {
  try {
    const response = await fetch(new URL('/.well-known/t3/environment', origin), { signal: AbortSignal.timeout(10_000) });
    const migration = record(await response.json()).databaseMigration;
    return typeof migration === 'number' ? migration : null;
  } catch {
    return null;
  }
}

export function readAccessToken(file: string = DEFAULT_TOKEN_FILE): string | null {
  const fromEnv = str(process.env.T3_ACCESS_TOKEN?.trim());
  if (fromEnv) return fromEnv;
  return existsSync(file) ? str(readFileSync(file, 'utf8').trim()) : null;
}

// ---- Snapshot: the same shape as readThread in store.ts, so mapThread is unchanged. ----

export function snapshotFromProjection(projection: Json, project: T3Project | null, migration: number | null): T3ThreadSnapshot {
  const thread = record(projection.thread);
  const threadId = String(thread.id ?? '');
  const own = (row: Json) => row.threadId === undefined || row.threadId === threadId;
  const list = (value: unknown) => (Array.isArray(value) ? value.map(record).filter(own) : []);
  const runs: T3Run[] = list(projection.runs)
    .map((run) => ({
      run_id: String(run.id),
      ordinal: Number(run.ordinal),
      provider: String(run.providerInstanceId ?? ''),
      provider_thread_id: str(run.providerThreadId),
      status: String(run.status ?? ''),
      requested_at: String(run.requestedAt ?? ''),
      completed_at: str(run.completedAt),
      payload: run,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
  const items: T3Item[] = list(projection.turnItems)
    .map((item) => ({
      turn_item_id: String(item.id),
      run_id: str(item.runId),
      ordinal: Number(item.ordinal),
      type: String(item.type ?? ''),
      status: String(item.status ?? ''),
      updated_at: String(item.updatedAt ?? ''),
      payload: item,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
  const checkpoints: T3Checkpoint[] = list(projection.checkpoints)
    .map((checkpoint) => ({
      checkpoint_id: String(checkpoint.id),
      run_id: str(checkpoint.runId),
      status: String(checkpoint.status ?? ''),
      captured_at: String(checkpoint.capturedAt ?? ''),
      payload: checkpoint,
    }))
    .sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0));
  return {
    migration,
    thread: {
      thread_id: threadId,
      project_id: String(thread.projectId ?? ''),
      title: String(thread.title ?? ''),
      created_at: String(thread.createdAt ?? ''),
      updated_at: String(thread.updatedAt ?? ''),
      payload: thread,
    },
    project,
    runs,
    items,
    checkpoints,
    // The projection has no model-selection or provider-switch events. mapThread does not read them.
    selection_changes: [],
  };
}

async function inBatches<T>(values: T[], size: number, run: (value: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < values.length; i += size) await Promise.all(values.slice(i, i + size).map(run));
}

export type RpcReadOptions = { origin?: string; accessToken?: string; tokenFile?: string; timeoutMs?: number };

export async function readThreadViaRpc(threadId: string, opts: RpcReadOptions = {}): Promise<T3ThreadSnapshot> {
  const origin = opts.origin ?? defaultOrigin();
  const accessToken = opts.accessToken ?? readAccessToken(opts.tokenFile);
  if (!accessToken) throw new T3RpcError(`No T3 access token. Pair once: run \`t3 pair --scope ${READ_SCOPE} --label DevLens\`, then \`npx tsx packages/t3/src/rpc.ts --pair\` with the token in T3_PAIRING_TOKEN.`);
  const client = await T3RpcClient.connect(rpcUrl(origin, await mintRpcTicket(origin, accessToken)), opts.timeoutMs);
  try {
    const isSnapshot = (value: unknown) => record(value).kind === 'snapshot';
    const detail = await client.first<Json>('orchestration.subscribeThread', { threadId }, isSnapshot);
    const projection = record(detail.projection);
    const shell = await client.first<Json>('orchestration.subscribeShell', {}, isSnapshot);
    const projectId = record(projection.thread).projectId;
    const found = (Array.isArray(record(shell.snapshot).projects) ? (record(shell.snapshot).projects as unknown[]) : []).map(record).find((p) => p.id === projectId);
    const project = found ? { project_id: String(found.id), title: String(found.title ?? ''), workspace_root: String(found.workspaceRoot ?? '') } : null;
    const items = Array.isArray(projection.turnItems) ? (projection.turnItems as unknown[]).map(record) : [];
    await inBatches(
      items.filter((item) => TRIMMED_ON_WIRE.has(String(item.type))),
      BODY_CONCURRENCY,
      async (item) => {
        const full = record((await client.request<Json>('orchestration.getTurnItem', { threadId, itemId: item.id })).item);
        if (full.id === item.id) {
          for (const key of Object.keys(item)) delete item[key];
          Object.assign(item, full);
        }
      },
    );
    return snapshotFromProjection(projection, project, await databaseMigration(origin));
  } finally {
    client.close();
  }
}

// ---- Entry point: `npx tsx packages/t3/src/rpc.ts --thread <id> [--compare]` or `--pair`. ----

function summarize(snapshot: T3ThreadSnapshot): string {
  const types = new Map<string, number>();
  for (const item of snapshot.items) types.set(item.type, (types.get(item.type) ?? 0) + 1);
  const models = [...new Set(snapshot.runs.map((run) => `${run.provider}/${str(record(run.payload.modelSelection).model) ?? 'unknown'}`))];
  return [
    `thread ${snapshot.thread.thread_id}: ${snapshot.thread.title}`,
    `project ${snapshot.project?.title ?? 'unknown'} (${snapshot.project?.workspace_root ?? 'no root'})`,
    `runs ${snapshot.runs.length} · items ${snapshot.items.length} · checkpoints ${snapshot.checkpoints.length} · migration ${snapshot.migration ?? 'unknown'}`,
    `models ${models.join(', ') || 'none'}`,
    ...[...types].sort((a, b) => b[1] - a[1]).map(([type, count]) => `  ${type}: ${count}`),
  ].join('\n');
}

// EVAL-7: map the RPC snapshot and the SQLite snapshot with the same mapper and compare events by id and payload.
async function compare(rpc: T3ThreadSnapshot): Promise<number> {
  const { openT3, readThread } = await import('./store');
  const { mapThread } = await import('./map');
  const db = openT3();
  const local = readThread(db, rpc.thread.thread_id);
  db.close();
  const now = new Date('2026-01-01T00:00:00Z');
  const a = new Map(mapThread(local, { now }).events.map((event) => [event.id, event]));
  const b = new Map(mapThread(rpc, { now }).events.map((event) => [event.id, event]));
  const differences: string[] = [];
  for (const id of a.keys()) if (!b.has(id)) differences.push(`only in SQLite: ${id}`);
  for (const id of b.keys()) if (!a.has(id)) differences.push(`only in RPC: ${id}`);
  for (const [id, event] of a) {
    const other = b.get(id);
    if (other && JSON.stringify(event) !== JSON.stringify(other)) differences.push(`payload differs: ${id}`);
  }
  console.log(`EVAL-7: SQLite events ${a.size}, RPC events ${b.size}, differences ${differences.length} (checkpoints included; git diffs are added later by cli.ts, not here)`);
  for (const line of differences.slice(0, 50)) console.log(`  ${line}`);
  return differences.length;
}

async function pair(tokenFile: string, pairingFile: string | undefined): Promise<void> {
  const pairingToken = str(process.env.T3_PAIRING_TOKEN?.trim()) ?? (pairingFile ? str(readFileSync(pairingFile, 'utf8').trim()) : null);
  if (!pairingToken) throw new Error('Set T3_PAIRING_TOKEN (or --pairing-token-file <path>) to the token that `t3 pair` printed. Do not pass it as an argument.');
  const result = await exchangePairingToken(defaultOrigin(), pairingToken);
  if (result.scope !== READ_SCOPE) throw new Error(`T3 granted scope "${result.scope}", not "${READ_SCOPE}". Token not saved.`);
  mkdirSync(path.dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, `${result.accessToken}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  console.log(`Paired with scope ${result.scope}. Token saved to ${tokenFile} (mode 600), expires in ${Math.round(result.expiresIn / 86400)} days. Revoke it in T3's connections list.`);
}

async function main(argv: readonly string[]): Promise<void> {
  const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const tokenFile = value('--token-file') ?? DEFAULT_TOKEN_FILE;
  if (argv.includes('--pair')) return pair(tokenFile, value('--pairing-token-file'));
  const threadId = value('--thread');
  if (!threadId) {
    console.log('Usage: npx tsx packages/t3/src/rpc.ts --thread <id> [--compare] [--origin <url>] [--token-file <path>] | --pair [--pairing-token-file <path>]');
    process.exitCode = 1;
    return;
  }
  const snapshot = await readThreadViaRpc(threadId, { origin: value('--origin'), tokenFile });
  console.log(summarize(snapshot));
  if (argv.includes('--compare') && (await compare(snapshot)) > 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
