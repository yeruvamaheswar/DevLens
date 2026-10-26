import { createClient } from '@supabase/supabase-js';
import { localReplay, sessionId, fixtureLabel } from './fixture';
import type { Event, Edge, Replay } from './event';
export async function loadReplay(offline = false): Promise<Replay> {
 if (offline || process.env.DEVLENS_OFFLINE === '1') return localReplay();
 try {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret=process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !secret) throw new Error('configuration unavailable');
  if (new URL(url).hostname !== 'hivfaqlabtbrhrviwrrm.supabase.co') throw new Error('project unavailable');
  const reader=createClient(url,key,{auth:{persistSession:false}});
  const [eventsResult,edgesResult]=await Promise.all([reader.from('events').select('*').eq('session_id',sessionId).order('seq'),reader.from('edges').select('*')]);
  if (eventsResult.error || edgesResult.error || !eventsResult.data?.length) throw new Error('fixture unavailable');
  const events=eventsResult.data as Event[], edges=edgesResult.data as Edge[];
  const ref=events.find(e=>e.recording_ref)?.recording_ref;
  if (!ref) throw new Error('media reference unavailable');
  const admin=createClient(url,secret,{auth:{persistSession:false}});
  const {data,error}=await admin.storage.from('recordings').createSignedUrl(ref,120);
  if (error || !data) throw new Error('signing unavailable');
  return {mode:'supabase',label:fixtureLabel,events,edges,media:{url:data.signedUrl,expires_at:new Date(Date.now()+120000).toISOString()},warning:'Generated placeholder video; visual review pending. No live capture or independent re-run.'};
 } catch { const local=await localReplay(); return {...local,warning:`Supabase unavailable; using local fixture. ${local.warning}`}; }
}
