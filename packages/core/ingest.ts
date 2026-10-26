import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { localReplay, fixturePath } from './fixture';
process.loadEnvFile?.('.env');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
if(!url || !secret) throw new Error('Ingest requires server configuration; no data was sent.');
if(new URL(url).hostname!=='hivfaqlabtbrhrviwrrm.supabase.co') throw new Error('Project does not match the authorized tracer project.');
const client=createClient(url,secret,{auth:{persistSession:false}}),fixture=await localReplay();
function checkWrite(table: string, {error}: {error: unknown}) {
 if(error) throw new Error(`Ingest failed for ${table}; check migration and access.`);
}
checkWrite('events', await client.from('events').upsert(fixture.events));
checkWrite('edges', await client.from('edges').upsert(fixture.edges));
checkWrite('entities', await client.from('entities').upsert([{id:'broken-api',kind:'task',attrs:{label:fixture.label}}]));
const {error}=await client.storage.from('recordings').upload('tracer-fixture-1/session.webm',await readFile(fixturePath('session.webm')),{contentType:'video/webm',upsert:true});
if(error)throw new Error('Private media upload failed.');
console.log(`events: ${fixture.events.length}, edges: ${fixture.edges.length}, objects: 1`);
