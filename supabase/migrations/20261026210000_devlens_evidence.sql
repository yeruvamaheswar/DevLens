-- Tracer fixture only. Apply only to project hivfaqlabtbrhrviwrrm.
begin;
create table public.events (
 id text primary key, session_id text not null, project_id text not null,
 ts timestamptz not null, seq integer not null,
 actor text not null check(actor in ('developer','agent','tool','ci','unknown')),
 type text not null check(type in ('prompt','tool_call','file_edit','test','question','answer','recording_start','pause','resume','stop')),
 source text not null check(source in ('claude_code_hook','git','sandbox','devlens_question','media_recorder')),
 provenance text not null check(provenance in ('observed','inferred')),
 recording_ref text, media_offset_ms integer check(media_offset_ms >= 0), tool_use_id text,
 payload jsonb not null, unique(session_id,seq)
);
create table public.entities(id text primary key,kind text not null check(kind in ('task','file','commit','test','competency')),attrs jsonb not null);
create table public.edges(id text primary key,src text not null references public.events(id),dst text not null references public.events(id),rel text not null,derived_by text not null,provenance text not null check(provenance in ('observed','inferred')),evidence_event_ids jsonb not null);
alter table public.events enable row level security;
alter table public.entities enable row level security;
alter table public.edges enable row level security;
grant select on public.events,public.entities,public.edges to anon,authenticated;
revoke insert,update,delete on public.events,public.entities,public.edges from anon,authenticated;
grant all on public.events,public.entities,public.edges to service_role;
create policy fixture_events_read on public.events for select to anon,authenticated using(session_id='tracer-fixture-1');
create policy fixture_entities_read on public.entities for select to anon,authenticated using(id='broken-api');
create policy fixture_edges_read on public.edges for select to anon,authenticated using(
 exists(select 1 from public.events e where e.id=src and e.session_id='tracer-fixture-1') and
 exists(select 1 from public.events e where e.id=dst and e.session_id='tracer-fixture-1')
);
insert into storage.buckets(id,name,public) values('recordings','recordings',false) on conflict(id) do update set public=false;
-- No anon/authenticated Storage policy: uploads and direct reads are denied.
commit;
