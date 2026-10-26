import { existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { projectOrigin } from '../../record/project';
import type { StoragePort } from './handler';

export function loadRepoEnv(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      try { process.loadEnvFile?.(file); } catch { /* leave the process environment unchanged */ }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function openRecordingStorage(
  env: { url?: string; secret?: string },
  connect: (origin: string, secret: string) => StoragePort,
): StoragePort | null {
  const origin = projectOrigin(env.url);
  if (!origin || !env.secret) return null;
  return connect(origin, env.secret);
}

export function storageFromEnv(): StoragePort | null {
  return openRecordingStorage(
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY },
    (origin, secret) => {
      const bucket = createClient(origin, secret, { auth: { persistSession: false } }).storage.from('recordings');
      return {
        async createSignedUploadUrl(objectPath) {
          const { data, error } = await bucket.createSignedUploadUrl(objectPath);
          if (error || !data?.token || (data.path && data.path !== objectPath)) return { ok: false };
          return { ok: true, token: data.token };
        },
        async writeMeta(objectPath, body) {
          const { error } = await bucket.upload(objectPath, Buffer.from(body, 'utf8'), {
            contentType: 'application/json',
            upsert: false,
          });
          return error ? { ok: false } : { ok: true };
        },
      };
    },
  );
}
