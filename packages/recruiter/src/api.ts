import path from 'node:path';
import type { RecruiterEntry } from './build';
import { isSharing, readEntries, requestStatus, setSharing } from './store';

export type RecruiterState = { available: boolean; sharing: boolean; project: string | null; updates: RecruiterEntry[] };
export type ApiResult = { status: number; body: Record<string, unknown> };

// The folder comes only from the server's own environment. A client never names a path.
export function projectDirFromEnv(env: Record<string, string | undefined>): string | null {
  const raw = env.DEVLENS_PROJECT_DIR;
  return typeof raw === 'string' && raw.trim().length > 0 ? path.resolve(raw.trim()) : null;
}

// Newest first. With sharing off the recruiter sees no entries, including old ones.
export function readRecruiterState(dir: string | null): RecruiterState {
  if (!dir) return { available: false, sharing: false, project: null, updates: [] };
  const project = path.basename(dir) || null;
  if (!isSharing(dir)) return { available: true, sharing: false, project, updates: [] };
  return { available: true, sharing: true, project, updates: readEntries(dir).reverse() };
}

const bad = (error: string, status = 400): ApiResult => ({ status, body: { error } });

export function applyRecruiterPost(dir: string | null, input: unknown, env: Record<string, string | undefined> = process.env, now = new Date()): ApiResult {
  if (!dir) return bad('recruiter unavailable: DEVLENS_PROJECT_DIR is not set', 503);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return bad('body must be an object');
  const body = input as Record<string, unknown>;

  if (body.type === 'share') {
    if (typeof body.enabled !== 'boolean') return bad('enabled must be true or false');
    setSharing(dir, body.enabled);
    return { status: 200, body: { sharing: body.enabled } };
  }

  if (body.type === 'request_status') {
    if (!isSharing(dir)) return bad('sharing_off', 409);
    const result = requestStatus(dir, { env, now });
    if (!result.sent) return bad(result.skipped ?? 'status_not_built', 503);
    return { status: 200, body: { entry: result.sent } };
  }

  return bad('type must be share or request_status');
}
