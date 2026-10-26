import type { RecordingGrant, RecordingMeta } from '../../../../packages/core/event';
import { isUuid } from '../../record/project';
import { parseGrantBody, parseMetaBody, recordingEnabled, recordingIdFromMetaUrl, sameOrigin } from './gates';

export type StoragePort = {
  createSignedUploadUrl: (path: string) => Promise<{ ok: true; token: string } | { ok: false }>;
  writeMeta: (path: string, body: string) => Promise<{ ok: true } | { ok: false }>;
};

export type RecordingDeps = {
  enabledFlag: string | undefined;
  openStorage: () => StoragePort | null;
  newId?: () => string;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function refused(request: Request, deps: RecordingDeps): Response | null {
  if (!recordingEnabled(deps.enabledFlag)) return json({ error: 'recording is off' }, 403);
  if (!sameOrigin(request)) return json({ error: 'origin was refused' }, 403);
  return null;
}

export async function postGrant(request: Request, deps: RecordingDeps): Promise<Response> {
  const blocked = refused(request, deps);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'request body must be JSON' }, 400);
  }
  const parsed = parseGrantBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  let storage: StoragePort | null;
  try {
    storage = deps.openStorage();
  } catch {
    return json({ error: 'recording storage is unavailable' }, 403);
  }
  if (!storage) return json({ error: 'recording storage is unavailable' }, 403);
  const recordingId = (deps.newId ?? (() => crypto.randomUUID()))();
  if (!isUuid(recordingId)) return json({ error: 'recording storage is unavailable' }, 403);
  const path = `${recordingId.toLowerCase()}/take.webm`;
  try {
    const signed = await storage.createSignedUploadUrl(path);
    if (!signed.ok || !signed.token) return json({ error: 'recording grant failed' }, 502);
    const grant: RecordingGrant = { recording_id: recordingId.toLowerCase(), path, token: signed.token };
    return json(grant, 200);
  } catch {
    return json({ error: 'recording grant failed' }, 502);
  }
}

export async function postMeta(request: Request, deps: RecordingDeps): Promise<Response> {
  const blocked = refused(request, deps);
  if (blocked) return blocked;
  const urlId = recordingIdFromMetaUrl(request.url);
  if (!urlId) return json({ error: 'recording id is invalid' }, 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'request body must be JSON' }, 400);
  }
  const parsed = parseMetaBody(body, urlId);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  let storage: StoragePort | null;
  try {
    storage = deps.openStorage();
  } catch {
    return json({ error: 'recording storage is unavailable' }, 403);
  }
  if (!storage) return json({ error: 'recording storage is unavailable' }, 403);
  const stored: RecordingMeta = { ...parsed.meta, recording_ref: `${urlId}/take.webm` };
  try {
    const written = await storage.writeMeta(`${urlId}/meta.json`, JSON.stringify(stored));
    if (!written.ok) return json({ error: 'recording details were not stored' }, 502);
  } catch {
    return json({ error: 'recording details were not stored' }, 502);
  }
  return json({ ok: true }, 200);
}
