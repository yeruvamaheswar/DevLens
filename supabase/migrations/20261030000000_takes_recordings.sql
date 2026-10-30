-- Apply only to project hivfaqlabtbrhrviwrrm. Take ingest contract (plans/take-ingest-contract.md), sections 1 and 4.
-- Adds takes and recordings, lets T3 rows into events, and adds public.replace_take.
-- Rollback SQL is in the migration plan doc, not in this file.

-- events: allow T3 rows (live constraints: events_type_check, events_source_check)
alter table public.events drop constraint events_type_check;
alter table public.events add constraint events_type_check check (type in
  ('prompt','tool_call','file_edit','test','question','answer','recording_start','pause','resume','stop','checkpoint'));
alter table public.events drop constraint events_source_check;
alter table public.events add constraint events_source_check check (source in
  ('claude_code_hook','git','sandbox','devlens_question','media_recorder','t3_code'));

create table public.takes (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  label text not null,
  adapter text not null check (adapter in ('claude_code_hook','t3_code')),
  capture_status text not null check (capture_status in ('verified','experimental')),
  authorship text not null check (authorship in ('human','scripted')),
  authorship_note text,
  scenario text,
  session_ids text[] not null check (cardinality(session_ids) > 0),
  analysis_status text not null check (analysis_status in ('complete','partial','missing','failed')),
  analysis_version text not null,
  verification text not null check (verification in ('rerun_passed','rerun_failed','none')),
  coverage jsonb not null default '{}'::jsonb,  -- {"unknowns": string[], "not_captured": string[]}
  recorded_at timestamptz,
  visible boolean not null default false,
  content_reviewed_at timestamptz,               -- set only after Uma watched the playback file
  ingested_at timestamptz not null default now()
);

create table public.recordings (
  id text primary key,
  take_id text not null references public.takes(id) on delete cascade,
  bucket text not null default 'recordings' check (bucket = 'recordings'),
  object_path text not null unique,
  content_type text not null check (content_type in ('video/mp4','video/webm')),
  bytes bigint not null check (bytes > 0 and bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes bigint not null check (source_bytes > 0),
  duration_ms integer not null check (duration_ms > 0),
  width integer, height integer,
  mode text not null check (mode in ('window','desktop')),
  consent boolean not null check (consent),
  audio_tracks integer not null check (audio_tracks = 0),
  sync jsonb not null,       -- see section 4
  redaction jsonb not null,  -- see section 4
  created_at timestamptz not null default now()
);
create index recordings_take_id_idx on public.recordings (take_id);
create index edges_src_idx on public.edges (src);
create index edges_dst_idx on public.edges (dst);

alter table public.takes enable row level security;
alter table public.recordings enable row level security;
revoke all on public.takes, public.recordings from anon, authenticated;
grant all on public.takes, public.recordings to service_role;
-- No anon/authenticated policies in P0: the server key reads; Vercel Authentication gates the site.

update storage.buckets
set allowed_mime_types = array['video/webm','video/mp4','application/json']
where id = 'recordings' and public = false;

-- Replace one take atomically: its row, the events and edges of its sessions, and its recording row.
-- A function body runs as one transaction, so a failed insert rolls back the deletes.
create or replace function public.replace_take(p_take jsonb, p_recording jsonb, p_events jsonb, p_edges jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id text := p_take->>'id';
  v_sessions text[];
  n_events integer;
  n_edges integer;
  n_recordings integer := 0;
begin
  -- 0. One replace_take at a time, so two calls cannot both pass the overlap check in step 4 (review A, nit 1).
  perform pg_advisory_xact_lock(hashtext('public.replace_take'));

  -- 1. Required id, sessions, and arrays.
  if v_id is null or v_id = '' then
    raise exception 'take id required';
  end if;
  if jsonb_typeof(p_take->'session_ids') is distinct from 'array' then
    raise exception 'session_ids must be a json array';
  end if;
  select coalesce(array_agg(s), '{}') into v_sessions from jsonb_array_elements_text(p_take->'session_ids') s;
  if cardinality(v_sessions) = 0 then
    raise exception 'session_ids required';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_typeof(p_edges) is distinct from 'array' then
    raise exception 'events and edges must be json arrays';
  end if;

  -- 2. Every event belongs to one of the take's sessions.
  if exists (select 1 from jsonb_populate_recordset(null::public.events, p_events) e
              where e.session_id is null or not (e.session_id = any (v_sessions))) then
    raise exception 'every event must belong to a session of the take';
  end if;

  -- 3. Every edge names events of this payload at both ends.
  if exists (select 1 from jsonb_populate_recordset(null::public.edges, p_edges) g
              where not exists (select 1 from jsonb_populate_recordset(null::public.events, p_events) e where e.id = g.src)
                 or not exists (select 1 from jsonb_populate_recordset(null::public.events, p_events) e where e.id = g.dst)) then
    raise exception 'every edge src and dst must be an event of the take';
  end if;

  -- 4. A session belongs to one take only.
  if exists (select 1 from public.takes t where t.id <> v_id and t.session_ids && v_sessions) then
    raise exception 'another take already lists one of these sessions';
  end if;

  -- 5. Upsert the take. visible is always false here; publishing is a separate step.
  insert into public.takes (id, label, adapter, capture_status, authorship, authorship_note, scenario, session_ids,
                            analysis_status, analysis_version, verification, coverage, recorded_at, visible,
                            content_reviewed_at, ingested_at)
  values (v_id, p_take->>'label', p_take->>'adapter', p_take->>'capture_status', p_take->>'authorship',
          p_take->>'authorship_note', p_take->>'scenario', v_sessions,
          p_take->>'analysis_status', p_take->>'analysis_version', p_take->>'verification',
          case when jsonb_typeof(p_take->'coverage') = 'object' then p_take->'coverage' else '{}'::jsonb end,
          (p_take->>'recorded_at')::timestamptz, false,
          (p_take->>'content_reviewed_at')::timestamptz, now())
  on conflict (id) do update set
    label = excluded.label,
    adapter = excluded.adapter,
    capture_status = excluded.capture_status,
    authorship = excluded.authorship,
    authorship_note = excluded.authorship_note,
    scenario = excluded.scenario,
    session_ids = excluded.session_ids,
    analysis_status = excluded.analysis_status,
    analysis_version = excluded.analysis_version,
    verification = excluded.verification,
    coverage = excluded.coverage,
    recorded_at = excluded.recorded_at,
    visible = false,
    content_reviewed_at = excluded.content_reviewed_at,
    ingested_at = excluded.ingested_at;

  -- 6. Replace the events and edges of these sessions.
  delete from public.edges
   where src in (select id from public.events where session_id = any (v_sessions))
      or dst in (select id from public.events where session_id = any (v_sessions));
  delete from public.events where session_id = any (v_sessions);

  insert into public.events select * from jsonb_populate_recordset(null::public.events, p_events);
  get diagnostics n_events = row_count;
  insert into public.edges select * from jsonb_populate_recordset(null::public.edges, p_edges);
  get diagnostics n_edges = row_count;

  -- 7. Replace the take's recording row. take_id is forced to this take.
  delete from public.recordings where take_id = v_id;
  if p_recording is not null and jsonb_typeof(p_recording) <> 'null' then
    if jsonb_typeof(p_recording) <> 'object' then
      raise exception 'recording must be a json object or null';
    end if;
    insert into public.recordings (id, take_id, bucket, object_path, content_type, bytes, sha256, source_sha256,
                                   source_bytes, duration_ms, width, height, mode, consent, audio_tracks, sync, redaction)
    select r.id, v_id, coalesce(r.bucket, 'recordings'), r.object_path, r.content_type, r.bytes, r.sha256, r.source_sha256,
           r.source_bytes, r.duration_ms, r.width, r.height, r.mode, r.consent, r.audio_tracks, r.sync, r.redaction
      from jsonb_populate_record(null::public.recordings, p_recording) r;
    get diagnostics n_recordings = row_count;
  end if;

  -- 8. Counts for the caller's check.
  return jsonb_build_object('events', n_events, 'edges', n_edges, 'recordings', n_recordings);
end;
$$;

revoke all on function public.replace_take(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_take(jsonb, jsonb, jsonb, jsonb) to service_role;
