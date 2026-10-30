# Recruiter review + Supabase migration: handoff (2026-10-29, ~17:40 local)

Stopped cleanly at Uma's request. Nothing is running. Nothing was committed, pushed, uploaded, or migrated.

## Status

| Phase | State | Evidence |
|---|---|---|
| 1 Discover | Done | `docs/SESSION_ASSET_INVENTORY.md` |
| 2 Validate | Done for the Full-Stack take (7 independent links, 2 frame anchors ±0.4 s) | inventory, "Association proof" |
| 3 Design | Decided (below). Not yet written up as docs | this file |
| 4 Prepare migration | Dry-run counts exist; no ingest code yet | below |
| 5 Implement | Not started. Needs Uma's approvals | below |
| Video blur | Requested by Uma at stop time. Not started | plan below |

Still to write: `docs/SUPABASE_MIGRATION_PLAN.md`, `docs/RECRUITER_REVIEW_ARCHITECTURE.md`, `docs/RECRUITER_DEMO_PLAN.md`, `docs/IMPLEMENTATION_ROADMAP.md` (P0/P1/P2 + the 14 decision answers). Write them from this file and the inventory. Do not redo discovery.

## Concurrent work in this repo: do not touch

Another session changed `README.md` (+369/−136) and created `docs/PRESENTATION_GUIDE.md`, `docs/media/`, and `.build/demo-videos/` at 17:18–17:33. Leave them. Coordinate before any commit, so one commit does not sweep in the other session's files.

## Decided architecture (Option C, hybrid, smallest change)

- **Postgres:** keep `events` and `edges`. Add two tables: `takes` (reviewable unit; `session_ids text[]`, label, adapter, `capture_status`, `authorship` human|scripted, `analysis_status` complete|partial|missing|failed, `analysis_version`, `verification` rerun_passed|rerun_failed|none, `coverage jsonb`, `content_reviewed_at`, `visible` default false) and `recordings` (one playable object; `take_id` FK, `object_path` = `events.recording_ref`, `sha256`, `source_sha256`, `duration_ms`, mode, consent, `audio_tracks = 0`, `sync jsonb` {basis, wall_start_ms, uncertainty_ms, anchors}, `redaction jsonb`, status).
- **Constraint fixes:** `events_type_check` add `checkpoint`; `events_source_check` add `t3_code`. T3 rows fail today without them. Add indexes on `edges(src)` and `edges(dst)`.
- **RPC:** `replace_take(take, recordings, events, edges)` in one transaction, modeled on `replace_session`. Note: `replace_session` exists live but is missing from the live migration history (drift).
- **Storage:** private `recordings` bucket, add `video/mp4` to allowed types, path `takes/<take_id>/<sha256-8>.mp4`. New private `take-artifacts` bucket for raw JSONL (server key only). Originals stay local: the Free plan caps files at 50 MB.
- **Not in P0:** candidates, analysis_runs, verification_runs, review_access tables, queues, HLS, AI summaries.
- **Analysis:** deterministic. Claude Code takes: edges from the existing linker at ingest. T3 takes: keep the capture's own `edges.jsonl` (51 edges for R3; the generic linker rebuilds only 16). Journey layout is built per request by the existing `buildJourney`. No model call at view time.
- **App:** new journey source key `take:<id>` in `apps/web/journey/sources.ts`, read from Supabase with the server key (also on Vercel, like `t3-pub:`). Media: `/api/journey/media?source=take:<id>` returns 302 to a signed URL (TTL ~900 s), as `t3-pub:` already does. Reuse the `/recruiter` picker, video, seek button, and evidence panel. They already disable seek and say why when no offset exists.
- **Access:** P0 relies on Vercel Authentication (SSO on all deployments). That is acceptable only for an internal demo. P1: Supabase Auth + `review_grants` + RLS, signed URLs minted only after an RLS-checked read.
- **Ingest CLI:** `npm run ingest -- --manifest <file> [--dry-run | --take <id> | --all]`. An explicit manifest per take (paths, session ids, sync spec with anchors, consent, `content_reviewed`, authorship); no filename guessing. Reuse `planSession`/`linkEvents` (`packages/cli/src/link.ts`), `attachMedia` (`packages/core/src/sync.ts`), and the secret guard in `packages/t3/src/publish.ts`. Scrub home paths to `~` before rows are written. Idempotent by take id and content-addressed object paths. `visible = true` only after an upload check, a row count check, a signed-URL Range probe, and `content_reviewed`.

## Verified platform facts (2026-10-29)

| Fact | Source |
|---|---|
| Supabase org plan is Free. Max file size 50 MB; egress 10 GB/month | `get_organization`; docs "Storage limits", "Bandwidth" |
| Resumable (TUS) upload is recommended above 6 MB, 6 MB chunks | docs "Resumable uploads" |
| Signed URLs cannot be revoked before expiry | docs "Serving assets" |
| Range request on a private signed URL works | `npm run demo:smoke`: all 5 checks PASS, live |
| Vercel Function request/response body limit 4.5 MB; Hobby max duration 300 s | docs "Vercel Functions Limits" |
| Hosted `/api/replay/media` sends the whole 16 MB WebM for `bytes=0-` | code; **failure on Vercel not verified** (no Vercel CLI; Hobby keeps runtime logs 1 h) |
| Vercel env: `SUPABASE_SECRET_KEY` (sensitive), `NEXT_PUBLIC_SUPABASE_URL`, `DEVLENS_OFFLINE=1` | `filter_project_envs` (names only) |
| Security advisor: only `sprintboard_issues` RLS-no-policy (intended) | `get_advisors` |

## Compression: verified

The test encode of R3 (259.2 MB, 494.77 s) gave 26.1 MB, 494.80 s, a keyframe every 2 s, no audio, and PSNR 42–49 dB against the original. It took 42 s. Output: `/tmp/devlens-encode-test/t3-named-g60.mp4` (disposable).

```
ffmpeg -i <original.mp4> -map 0:v:0 -an -c:v libx264 -preset medium -crf 30 \
  -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart <playback.mp4>
```

Do not trim (`-ss`) or change the start: offsets depend on media time 0. R5's `screen.mkv` is already H.264 (15.7 MB): remux to MP4 with faststart.

## Video blur plan (Uma's request, next step 1)

Text redaction of events does not touch the video. Blur in the same ffmpeg pass as compression, so there is one encode and offsets stay intact.

1. For each approved take, make a contact sheet (1 frame per 5 s) and list what shows personal details, with time ranges and boxes. Already seen in R2: the macOS menu bar (date, time, status icons), Terminal title bars showing the user name and `/tmp/...` paths, and `/Users/<name>/...` paths inside terminal output (for example `npm test --prefix /Users/...`). Check Chrome windows, the T3 sidebar (other project and thread names), and notifications too.
2. Static regions (menu bar, title bars): `split` → `crop` → `boxblur=20:2` → `overlay`, for the whole video.
3. Dynamic regions (paths in terminal text): the same filter with `enable='between(t,a,b)'` per range found in step 1.
4. Verify: duration unchanged, sync anchors still readable, no visible name or home path on a fresh contact sheet. Then Uma watches the result.
5. Record the regions in `recordings.redaction`. The UI says "Video blurred in N regions, reviewed by Uma on <date>". It never says "sanitized".

Leave originals untouched. Write blurred files to `.devlens/ingest/<take>/playback.mp4` (ignored by Git).

## Demo recommendation (to write up in `docs/RECRUITER_DEMO_PLAN.md`)

- **First in the library: golden take (R1).** It is the only take with a failed fix attempt, observed sync, an independent re-run, and human-typed prompts. Moments: fail 0:30.4, fix 0:52.9, still failing 0:53.7, fail 2:45.4, fix 2:56.9, pass 2:57.9, then the sandbox re-run passed (outside the recording).
- **Second: Full-Stack take 2 (R2).** It beats T3: verified adapter, legible 1080p, calibrated sync ±0.4 s. It is scripted and has no re-run. Moments (t0 = stamp + 3.4 s): fail 0:25.8, fix edit 0:51.5, pass 0:54.3, then feature prompts at 1:32, 2:39, 3:32 and 3 Q&A.
- T3 takes (R5, then R3) are experimental. R3 needs sync calibration first.
- Demo arc: library → golden chain → switch to Full-Stack for 30 s to show that a second take loads its own evidence, with "no re-run" and "±0.4 s seek" labels.

## Dry-run counts (existing `link --dry-run`, no network)

| Take | Events | Edges |
|---|---|---|
| R1 golden | 31 | 32 (matches Supabase; its 33rd edge is the tracer fixture) |
| R2 Full-Stack | 90 | 91 |
| R3 T3 named | 66 | 16 by linker; keep the capture's 51 |
| R5 T3 take 3 | 37 | 7 |

## Waiting on Uma

1. Approve the schema migration on project `devlens` (two tables, two CHECK changes, indexes, RPC, bucket MIME type).
2. Approve the takes to migrate: proposed R1 (backfill row only), R2, R5, R3. Not R4 (aborted) or R6–R9 (superseded).
3. Watch each blurred rendition and approve its upload.
4. Confirm the R7 and R9 links (renamed files), and pick R5's capture version (local or untracked saved copy).
5. Approve push and deploy when P0 passes locally.
6. Do the Supabase Pro upgrade only if originals must be stored centrally. Recommendation: no.

## Next steps, in order

1. Blur plus compress R2 (step 1 of the blur plan), and show Uma the contact sheet.
2. Write docs B–E from this file. Have a different session (Sonnet) review them.
3. After approval: migration → ingest CLI with tests → `take:` source → ingest R2 only (tracer bullet) → hosted check → the other takes.
