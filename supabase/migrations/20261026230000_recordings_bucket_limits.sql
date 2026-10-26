-- Apply only to project hivfaqlabtbrhrviwrrm. Condition C4 of the Slice 2 architecture review.
-- Cap uploads to the private recordings bucket: 50 MB, WebM video and the meta.json file only.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['video/webm', 'application/json']
where id = 'recordings' and public = false;
