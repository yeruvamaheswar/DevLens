-- Apply only to project hivfaqlabtbrhrviwrrm. CR-12 slice 3 (NOT-3).
-- Private bucket for published T3 captures. No policies for anon or authenticated:
-- storage.objects has RLS on, so only the server key (service role) can read or write.
-- Cap uploads: 50 MB, JSON, JSON Lines, and WebM video only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('t3-captures', 't3-captures', false, 52428800, array['application/json', 'application/x-ndjson', 'video/webm'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
