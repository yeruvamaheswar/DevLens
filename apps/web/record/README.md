# Window recorder

The record page is `/record`. A page load does not call `getDisplayMedia`. The developer clicks **Start recording**, reviews the file, and only then clicks **Upload**.

## `DEVLENS_RECORD_ENABLED`

Set this server-side variable to the exact value `1` to allow recording grants and metadata writes. Any other value, including an unset variable, makes `POST /api/recordings` and `POST /api/recordings/<id>/meta` return 403.

```text
DEVLENS_RECORD_ENABLED=1
```

Do not prefix it with `NEXT_PUBLIC_`. Add that line to the repo-root `.env.example`. Keep the real value in the local `.env`, which stays untracked.

Next serves `apps/web` and does not load the repo-root `.env` by itself. The recording routes load the first `.env` found from the process directory upward, and they do not override variables that are already set. They never print those values.

The browser upload uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The service-role key stays on the server. The only accepted Supabase host is `hivfaqlabtbrhrviwrrm.supabase.co`.

Desktop capture is not in this slice. The stored `mode` field remains `window`.
