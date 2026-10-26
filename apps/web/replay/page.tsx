"use client";
import { useEffect, useRef, useState } from 'react';
import type { Replay, Edge } from '../../../packages/core/event';
export default function ReplayPage() {
 const [data,setData]=useState<Replay|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<Edge|null>(null);
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{fetch('/api/replay'+(new URLSearchParams(location.search).has('offline')?'?offline=1':'')).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(setData).catch(()=>setError('Replay unavailable. Restart the local demo.'));},[]);
 if(!data)return <main>{error || 'Loading fixture…'}</main>;
 const cited=selected ? data.events.filter(e=>selected.evidence_event_ids.includes(e.id)||e.type==='answer'||e.type==='question') : [];
 return <main style={{maxWidth:960,margin:'48px auto',padding:24,fontFamily:'system-ui',lineHeight:1.6}}>
 <h1>DevLens Replay</h1><p><strong>{data.label}</strong> · {data.mode}</p><p>{data.warning}</p>
 <video ref={video} src={data.media.url} controls preload="metadata" style={{width:'100%',background:'#111'}} onError={()=>setError('Media unavailable. Reload to refresh the short-lived URL.')}/><p role="status">{error}</p>
 <h2>Failure to pass</h2>{data.edges.map(edge=>{const event=data.events.find(e=>e.id===edge.src);return <button key={edge.id} onClick={()=>{setSelected(edge);if(video.current&&event?.media_offset_ms!=null)video.current.currentTime=event.media_offset_ms/1000;}} style={{padding:16,cursor:'pointer'}}>Later passing check → patch · {edge.provenance}{event?.media_offset_ms==null?' · seek unknown':''}</button>;})}
 {selected&&<section><p>Rule: {selected.derived_by} · {selected.provenance}</p><p>Evidence: {selected.evidence_event_ids.join(', ')}</p>{cited.map(e=><article key={e.id}><h3>{e.id} · {e.type} · {e.provenance}</h3><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(e.payload,null,2)}</pre></article>)}</section>}
 <h2>Unknowns</h2><p>This is synthetic evidence. The recording is a generated placeholder. Inferred links do not establish causality. Passing checks may be incomplete. Unhooked changes and unmatched footage remain unattributed. No separate sandbox result exists. Nothing here predicts job performance.</p>
 </main>;
}
