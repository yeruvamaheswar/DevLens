-- Apply only to project hivfaqlabtbrhrviwrrm. Slice 5 review finding F2: replace one session atomically.
-- A function body runs as one transaction, so a failed insert rolls back the deletes.
create or replace function public.replace_session(p_session_id text, p_events jsonb, p_edges jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  n_events integer;
  n_edges integer;
begin
  if p_session_id is null or p_session_id = '' then
    raise exception 'session id required';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_typeof(p_edges) <> 'array' then
    raise exception 'events and edges must be json arrays';
  end if;
  if exists (select 1 from jsonb_populate_recordset(null::public.events, p_events) e where e.session_id is distinct from p_session_id) then
    raise exception 'every event must belong to the session being replaced';
  end if;

  delete from public.edges
   where src in (select id from public.events where session_id = p_session_id)
      or dst in (select id from public.events where session_id = p_session_id);
  delete from public.events where session_id = p_session_id;

  insert into public.events select * from jsonb_populate_recordset(null::public.events, p_events);
  get diagnostics n_events = row_count;
  insert into public.edges select * from jsonb_populate_recordset(null::public.edges, p_edges);
  get diagnostics n_edges = row_count;

  return jsonb_build_object('events', n_events, 'edges', n_edges);
end;
$$;

revoke all on function public.replace_session(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_session(text, jsonb, jsonb) to service_role;
