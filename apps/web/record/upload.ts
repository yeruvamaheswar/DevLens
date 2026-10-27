import { createClient } from '@supabase/supabase-js';
import type { RecordingGrant } from '../../../packages/core/event';
import { isUuid, projectOrigin } from './project';
import { metaFromTake, type TakeState } from './take';

export type SignedUpload = (input: {
  supabaseUrl: string;
  publishableKey: string;
  path: string;
  token: string;
  blob: Blob;
}) => Promise<void>;

async function uploadWithPublishableKey(input: {
  supabaseUrl: string;
  publishableKey: string;
  path: string;
  token: string;
  blob: Blob;
}): Promise<void> {
  const client = createClient(input.supabaseUrl, input.publishableKey, { auth: { persistSession: false } });
  const { error } = await client.storage.from('recordings').uploadToSignedUrl(input.path, input.token, input.blob, {
    contentType: 'video/webm',
    upsert: false,
  });
  if (error) throw new Error('upload failed');
}

function isGrant(value: unknown): value is RecordingGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<RecordingGrant>;
  return typeof grant.recording_id === 'string'
    && isUuid(grant.recording_id)
    && grant.path === `${grant.recording_id}/take.webm`
    && typeof grant.token === 'string'
    && grant.token.length > 0;
}

export async function uploadReviewedTake(input: {
  supabaseUrl: string;
  publishableKey: string;
  blob: Blob;
  take: TakeState;
  fetchImpl?: typeof fetch;
  uploadToSignedUrl?: SignedUpload;
}): Promise<void> {
  const origin = projectOrigin(input.supabaseUrl);
  if (!origin || !input.publishableKey) throw new Error('recording storage is unavailable');
  const fetchImpl = input.fetchImpl ?? fetch;
  const grantResponse = await fetchImpl('/api/recordings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: input.take.mode, consent: true }),
  });
  if (!grantResponse.ok) throw new Error('recording grant was refused');
  const grant: unknown = await grantResponse.json();
  if (!isGrant(grant)) throw new Error('recording grant was refused');
  const meta = metaFromTake(input.take, input.blob.size, grant.recording_id);
  if (!meta) throw new Error('take is incomplete');
  const send = input.uploadToSignedUrl ?? uploadWithPublishableKey;
  await send({
    supabaseUrl: origin,
    publishableKey: input.publishableKey,
    path: grant.path,
    token: grant.token,
    blob: input.blob,
  });
  const metaResponse = await fetchImpl(`/api/recordings/${grant.recording_id}/meta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!metaResponse.ok) throw new Error('recording details were refused');
}
