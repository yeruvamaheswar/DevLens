# Take ingest contract (P0)

Owner: Tech Lead session. Builders implement this exactly. A builder who needs a change stops and reports it; they do not change the contract on their own.
Context: `plans/recruiter-review-handoff.md`, `docs/SESSION_ASSET_INVENTORY.md`.
Approved by Uma on 2026-10-29: the Supabase schema change on project `devlens` (ref `hivfaqlabtbrhrviwrrm`), and migrating 4 takes.

## Terms

- **Take**: the unit a recruiter selects. One take = one or more agent sessions (`events.session_id`) + zero or one playback recording.
- **Recording**: one playable object in the private `recordings` bucket. Its `object_path` equals `events.recording_ref` for every event that has a media offset.
- **Evidence**: rows in `events` (observed). **Analysis**: rows in `edges` (rule-derived, each names its rule in `derived_by`). The journey view is computed per request by `buildJourney`. No model call at view time.

## 1. Schema (one migration file: `supabase/migrations/20261030000000_takes_recordings.sql`)

```sql
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
```

Plus the RPC `public.replace_take(p_take jsonb, p_recording jsonb, p_events jsonb, p_edges jsonb) returns jsonb`, in the same file, modeled on `replace_session` (one function body = one transaction):

1. Refuse when `p_take->>'id'` is empty, `session_ids` is empty, or `p_events`/`p_edges` is not an array.
2. Refuse when any event's `session_id` is not in `session_ids`.
3. Refuse when any edge's `src` or `dst` is not an id in `p_events`.
4. Refuse when another take (different id) already lists any of these `session_ids`.
5. Upsert the take row. Always write `visible = false`. Keep `content_reviewed_at` from the payload.
6. Delete edges touching events of these sessions, then those events. Insert `p_events`, then `p_edges` (`jsonb_populate_recordset`, as `replace_session` does).
7. Delete this take's recordings rows. If `p_recording` is not JSON null, insert it with `take_id` forced to the take id.
8. Return `{"events": n, "edges": n, "recordings": n}`.

`revoke all ... from public, anon, authenticated; grant execute ... to service_role;` and `set search_path = public`.

Rollback SQL goes in the migration plan doc, not in this file: drop the function and both tables, restore the two CHECK constraints, restore the bucket MIME list.

## 2. Storage

- Bucket `recordings` (private, 50 MB cap; the Free plan maximum).
- Object path: `takes/<take_id>/<first 12 hex of sha256>.mp4`. Content-addressed, so a re-run never overwrites different bytes.
- Upload with `upsert: false`. If the object exists, compare its size with the local file. Same size: skip. Different size: stop with an error.
- Originals stay local. Only the blurred playback file is uploaded. `source_sha256` records the original.

## 3. Manifest: `ingest/takes.manifest.json` (committed; paths use `~` or are repo-relative)

```json
{ "takes": [ {
  "id": "fullstack-take-2",
  "label": "...", "adapter": "claude_code_hook", "capture_status": "verified",
  "authorship": "scripted", "authorship_note": "...", "scenario": "...",
  "session_ids": ["..."],
  "events": ["<path to events.jsonl>"],
  "edges": null,                         // null: run the rule linker. A path: use that file's edges as-is (T3 captures)
  "rerun": null,                         // optional rerun.jsonl; its events keep null media
  "coverage": { "unknowns": [], "not_captured": [] },
  "verification": "none",
  "expected": { "events": 90 },
  "recording": null | {
    "id": "...", "playback": "<path>", "source": "<path to original>", "source_sha256": "<64 hex>",
    "mode": "desktop", "consent": true,
    "sync": { ... section 4 ... },
    "redaction": { ... section 4 ... }
  },
  "content_reviewed_at": null
} ] }
```

## 4. Sync and redaction objects

```json
"sync": {
  "basis": "media_recorder" | "recorder_clock_calibrated" | "recorder_timeline_uncalibrated",
  "wall_start_ms": 1793241549673,
  "uncertainty_ms": 400,
  "anchors": [ { "event_id": "...", "expected_video_s": 21.0, "observed_video_s": 20.9 } ]
}
"redaction": {
  "method": "apple-vision-ocr + ffmpeg boxblur",
  "spans": 48,
  "verified": { "fps": 6, "offset_s": 0.05, "pattern": "<regex>", "matches": 0 },
  "residual_note": "..."
}
```

Seek rule (enforced by ingest):
- `media_recorder`: write offsets with `attachMedia` (`packages/core/src/sync.ts`), using `wall_start_ms` and `wall_end_ms = wall_start_ms + duration_ms`.
- `recorder_clock_calibrated`: write offsets only when there are 2 or more anchors and every `|observed − expected| * 1000 <= uncertainty_ms`. Otherwise write `null` offsets.
- `recorder_timeline_uncalibrated`: always write `null` offsets. Playback works; seek is disabled.

## 5. Ingest CLI: `packages/cli/src/ingest.ts`, scripts `npm run ingest` and `npm run test:ingest`

```
npm run ingest -- --dry-run [--take <id> | --all]     # no network, no client; prints the plan
npm run ingest -- --take <id>                          # upload + replace_take; visible stays false
npm run ingest -- --take <id> --publish                # also sets visible = true; refuses without content_reviewed_at
```

Order per take:
1. Validate the manifest entry. Resolve `~`.
2. Read events (`readJsonl` pattern from `link.ts`). Every `session_id` must be in `session_ids`. The count must equal `expected.events`.
3. Claude Code takes: `attachMedia` per the seek rule, then `planSession` (`link.ts`) over session events + rerun events. T3 takes: keep the events, apply `attachMedia` per the seek rule, take edges from the `edges` file, and check that every src/dst exists.
4. Scrub every string in every payload: the home directory and any `/Users/<name>` prefix become `~`. Then refuse when any text contains `sb_secret_` or a value from `secretValuesFromEnv` (`packages/capture/redact.ts`), as `packages/t3/src/publish.ts` does.
5. Probe the playback file with `ffprobe`: H.264 or VP8/VP9, 0 audio streams, size ≤ 52428800, duration. Compute `sha256` of the playback file and of the source. The source hash must equal `source_sha256`.
6. `--dry-run` stops here and prints per take: events, edges, events with offsets / total, sync basis, playback bytes, sha256 (12), object path.
7. Live: the server env comes from the repo `.env` via `process.loadEnvFile`, as `link.ts` does. Assert the project host is `hivfaqlabtbrhrviwrrm.supabase.co`. Upload (section 2), then call `rpc('replace_take', …)`, then verify: row counts equal the plan, `storage.list` shows the object with the same size, and a signed URL answers `Range: bytes=0-1` with 206. Print PASS/FAIL per check. Never print keys or signed URLs.
8. `--publish`: only after every check passes and `content_reviewed_at` is set. Update `takes.visible = true`.

Tests (vitest, fake RPC and fake storage ports, temp dirs; no network): plan counts, the seek rule (calibrated pass, calibrated fail → null, uncalibrated → null), scrub, secret refusal, session mismatch refusal, edge src/dst refusal, idempotent upload skip, size-mismatch stop, publish refusal.

## 6. Read path (web)

Source key: `take:<id>` (id pattern as in the table).

- `listSources()` adds one row per `visible = true` take: `{ key: "take:<id>", label, status: capture_status, adapter }`. Reads use the server key with a 5 s timeout. The same env rule as `webCaptureBucket`: none when `DEVLENS_OFFLINE=1` and not `VERCEL`. A failure lists no takes and keeps the other sources.
- `loadJourney("take:<id>")`: read the take (must be visible), its events (`session_id = any(session_ids)`, ordered by ts, seq), edges whose `src` is in those event ids, and its recording row. Build `JourneySourceMeta` with the existing fields, plus:

```ts
take?: {
  authorship: 'human' | 'scripted'; authorship_note: string | null;
  analysis_status: 'complete' | 'partial' | 'missing' | 'failed';
  verification: 'rerun_passed' | 'rerun_failed' | 'none';
  sync: { basis: string; uncertainty_ms: number | null } | null;   // null when there is no recording
  redaction: { spans: number; matches: number } | null;
};
```

  `media` is `{ url: "/api/journey/media?source=take:<id>", label }` when a recording row exists, else `null`.
- `GET /api/journey/media?source=take:<id>`: the take must be visible and have a recording. Sign `object_path` for 900 s and return 302 with `Cache-Control: no-store`. Otherwise 404 "Recording unavailable." Never use a path from the request.
- Labels on `/recruiter` (short, factual):
  - `authorship = scripted`: "Scripted demo: the prompts and answers were typed by a script, not a developer." plus `authorship_note`.
  - `verification = none`: "Independent re-run: not run for this take."
  - Sync: `media_recorder` → "Seek: exact (browser recording clock)". `recorder_clock_calibrated` → "Seek: ±<uncertainty> s (checked against <n> on-screen moments)". Uncalibrated or no offsets → "Seek is off for this recording: its clock was not checked."
  - Redaction: "Personal details blurred in the video (<spans> areas, checked by OCR)."
  - No events: "Analysis not available for this recording."
  - `analysis_status = partial`: "Partial evidence: <unknowns>". Never fill a gap with invented text.

## 7. The 4 approved takes (manifest values)

| id | adapter | sessions | events file | edges | rerun | recording | sync | authorship |
|---|---|---|---|---|---|---|---|---|
| `golden-broken-api` | claude_code_hook, verified | `ec6f600a-3902-459e-8769-3c13e7361948`, `44a60462-1d30-4fa3-8c72-dbc789421a38` | `examples/broken-api/fixtures/golden/session.jsonl` (30) | linker | `golden/rerun.jsonl` (1) | `.devlens/ingest/golden-broken-api/playback.mp4` (blurred, verified 0 OCR matches); source `golden/session.webm`, sha `f718ffb052c2db355377073ba0db85a5739942e90fdb1c757f9789cb4c1e9567`, window | `media_recorder`, `wall_start_ms 1793117455405`, uncertainty 0 | human |
| `fullstack-take-2` | claude_code_hook, verified | `a04c678d-a85d-4fa6-bcae-bb35723fac7e` | `~/Code-Git-Repos/devlens-demo-recorder/out/rescued-tmp-backups/devlens-demo-backup-1793245064520/events.jsonl` (90) | linker | none | `.devlens/ingest/fullstack-take-2/playback.mp4` (copy of the peer session's blurred file after an independent OCR check); source sha `490967b67921acab5d58874cd15074203c78744f73ab66538fe7e33cbf22ae52`, desktop | `recorder_clock_calibrated`, `wall_start_ms 1793241549673`, ±400 ms, anchors `…:toolu_01MQzC568DuKo26YE2Wp4ho7:pre` expected 21.0 / observed 20.9, `…:toolu_01DKuxaEsn2Jr7iCMHVahonn:post` expected 51.5 / observed 51.6 | scripted |
| `t3-video-take` | t3_code, experimental | `t3:mcp:launch:2b44bbadd974e9a2199955f098401b4428a8b27b7971a088d5e9db7838fba8bc` | `~/Code-Git-Repos/DevLens-t3-fullstack/.devlens/t3/mcp:launch:2b44bbad…/events.jsonl` (66) | that folder's `edges.jsonl` (51) | none | `.devlens/ingest/t3-video-take/playback.mp4` (peer's blurred file, after check); source sha `ff5c748a44ab2bd484e290dc9600e8e886b1c133d415b1a9112d12b2e1be1e57`, desktop | `recorder_timeline_uncalibrated` until the Tech Lead adds 2 anchors | scripted |
| `t3-take-3` | t3_code, experimental | `t3:mcp:launch:a483250235ec2180f06b0fe017765fb29edfe99bc0988de2d676b30e4ec3852c` | `~/Code-Git-Repos/DevLens-t3-fullstack/examples/t3-captures/t3-fullstack-take-3/events.jsonl` (53, the saved copy) | that folder's `edges.jsonl` (30) | that folder's `rerun.jsonl` | **none**: the video shows the Tech Lead thread, not this coding thread, except 0:54–1:05 | n/a | scripted (prompts written by the Tech Lead agent) |
