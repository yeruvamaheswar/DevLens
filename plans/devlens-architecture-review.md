# Slice 2 — architecture and security review

Reviewer: Claude (Slice 2 owner). Date: 2026-10-26. Project `hivfaqlabtbrhrviwrrm` only. Key values never printed.
State: **REVIEWED, not VERIFIED.** An independent reviewer must repeat the RLS and secret checks.
Change made: `packages/core/event.ts` only (types; see "Shared interfaces"). No migration added. No DB change. No commit.

**Readiness: READY-WITH-CONDITIONS** (C1–C6 below).

## Findings

| ID | File | Consequence | Fix or PASS | Severity |
|---|---|---|---|---|
| A1 | RLS on `events`, `edges`, `entities` | Anon reads the fixture only | PASS. Live: anon sees 5 events, 1 edge, 1 entity. With a temp non-fixture session (2 events, 1 edge, 1 entity, 1 cross edge) anon still sees the same 5/1/1. Temp rows deleted. | — |
| A2 | Table grants | Writes denied | PASS. Anon INSERT/UPDATE/DELETE all `42501` on all 3 tables. SQL: `has_table_privilege` false for ins/upd/del for `anon` and `authenticated`. Only 3 SELECT policies. RLS on. Advisor: 0 lints. | — |
| A3 | Storage `recordings` | Private, no policy | PASS. Anon list returns `[]`; upload RLS violation; download and sign: "Object not found"; public, authenticated and plain URLs: HTTP 400. Bucket `public=false`. | — |
| A4 | `packages/core/server.ts:17` | Signed URL TTL 120 s | PASS on privacy: token claims `url, scope, iat, exp` (no key); 3 s URL returned 206 then HTTP 400 `InvalidJWT exp` after 5 s; path-tampered URL 400. | — |
| A5 | `server.ts:17` + `page.tsx` | After 120 s the video stops seeking. The page says "Reload". Looks like a broken demo at the table. | Not fixed (file not mine). Tech Lead: raise TTL to 600 s in Slice 7. 120 s is bounded and safe. | Low |
| A6 | Secret isolation | Key read only in `server.ts`, `ingest.ts`, `smoke.ts` (server/CLI). | PASS. `npm run build && npm run check:bundle` pass. Secret value: 0 hits in all of `apps/web/.next`. `/api/replay` body: 0 hits. Git history: no secret-shaped value. `.env` ignored and untracked. | — |
| A7 | Offline fallback | Bad Supabase URL | PASS. `next start` with `NEXT_PUBLIC_SUPABASE_URL=https://127.0.0.1:1`: HTTP 200, `mode:"local fixture"`, warning "Supabase unavailable; using local fixture", media `/api/replay/media`. Live env: `mode:"supabase"`, signed URL, `expires_at` set. Note: the host check fails before any network call, so a real timeout path is argued from the `catch`, not run. | — |
| A8 | `apps/web` env | `next start`/`next dev` from `apps/web` does not load the root `.env`; it falls back to fixture. `npm run demo` passes env, so the demo is fine. | Document only. Fallback is labeled, never silent. | Info |
| A9 | `event.ts` vs `docs/implementation.md` | Fields and allowed values match. Gaps: `tool_use_id` typed `string` but the DB returns `null`; no type for hook payloads, failure signal, unattributed, recorder meta, or link rule. | FIXED in `event.ts`: `tool_use_id?: string \| null`, plus `TestPayload`, `FileEditPayload`, `HookPayload`, `LinkRule`, `PauseSpan`, `RecordingMeta`, `RecordingGrant`. | Medium |
| A10 | Docs say `unattributed`; enum has only `unknown` | Slice 5 would invent a value; DB CHECK would reject. | DECIDED, no schema change: actor `unknown` + `payload.attribution:'unattributed'` + provenance `inferred`. | Medium |
| A11 | `events.id` is a global PK; fixture ids are `failure`, `pass` | Two sessions collide. | DECIDED: id formats below. | Medium |
| A12 | `unique(session_id, seq)` | Hook, recorder and sandbox cannot each own `seq`. | DECIDED: one ingest writer assigns `seq`; replace-session write. No migration. | Medium |
| A13 | RLS literals `tracer-fixture-1` / `broken-api` | The real golden session (Slice 6) is unreadable by the publishable key. | Not needed for Wave 3. Condition C5 (Wave 4). | Medium |
| A14 | Next route wrappers | Next serves only `apps/web/app/**`. Implementation in `apps/web/api/**`, `apps/web/replay/**`. Slice 4 Files lists do not include `apps/web/app/**`. | DECIDED below (canonical + wrapper rule). C2. | Medium |
| A15 | `entities.kind` allows `competency` | Docs (Rules 7) allow a count-only row. Applied migration cannot change. | ACCEPTED. No UI may show met/unmet; Slice 7 review greps verdict words. | Low |
| A16 | Signed upload token TTL 7200 s | Observed: token is bound to its path (other path: "Invalid signature"); anon cannot create one. Long-lived but single path. | Accept. Server picks the path. | Low |
| A17 | `POST /api/recordings` (future) | An unauthenticated route that mints upload tokens can fill Storage if the app is hosted publicly. | Condition C4. | Medium |
| A18 | Sandbox re-run (future) | `npm test` in the sandbox runs repo code. A child that inherits env gets `SUPABASE_SECRET_KEY`. | Condition C6. | High if unmet |
| A19 | `apps/web/next-env.d.ts` | Next rewrites it on every build; shows as modified. | Do not commit churn. | Info |

## Event provenance and hook facts (item 6)

| Probe fact | Event shape carries it? |
|---|---|
| No timestamp in payloads | Yes. Hook stamps `ts` (ISO UTC, ms) at write time. |
| `tool_use_id` pairs Pre and Post | Yes. `tool_use_id` field and in the id. |
| Failing bare `npm test` arrives as `PostToolUseFailure`, `error` starts "Exit code 1" | Yes. `type:'test'`, `TestPayload.status:'failed'`, `signal:'hook_failure'`. |
| Piped test arrives as `PostToolUse` with failure only in stdout | Yes. `signal:'output_parse'`. If neither signal is clear, `status:'unknown'`. Never guess pass. |
| No `exit_code` field | Not stored. Never invent one. |
| `prompt_id`, `permission_mode`, `duration_ms`, `is_interrupt` | `payload.prompt_id`, `payload.duration_ms`; the rest in `payload.raw`. |
| SessionStart, SessionEnd, Stop | No SessionStart event (session_id is on every event). `Stop` and `SessionEnd` → `type:'stop'`, `source:'claude_code_hook'`, `payload.hook_event_name`. |
| Parallel tool order not tested | Ingest orders by `(ts, file line)`. Pre must precede Post for the same id. Unknown beyond that. |

## Shared interfaces (decided now)

Owner of every shared file: **Tech Lead.** A builder never edits `packages/core/*`, `package.json`, `.gitignore`, `supabase/`.

### Event identity, seq, files

- Hook event id: tools `<session_id>:<tool_use_id>:pre` or `:post`; prompts and Stop `<session_id>:<hook_event_name>:<prompt_id>`. No counters. Ids are idempotent.
- Hook line is a full `Event` (`source:'claude_code_hook'`, `provenance:'observed'`, `recording_ref:null`, `media_offset_ms:null`). Hook mapping: UserPromptSubmit → `prompt`/`developer`; Pre → `tool_call`/`agent`, `phase:'pre'`; Post Edit/Write/MultiEdit → `file_edit`; Post Bash whose command matches `npm test|vitest|pytest` → `test` (`TestPayload`); other Post → `tool_call`, `phase:'post'|'failure'`.
- `seq` in a producer file is advisory (line order). Only the ingest writer assigns final `seq` 1..n, sorted by `(ts, source file order)`, and **replaces the whole session**: delete its edges, then its events, then insert events, then edges (service role). No upsert on `seq`.
- Files: hook → `.devlens/events.jsonl` (Slice 3). Re-run → `.devlens/rerun.jsonl` (Slice 5). Recorder → Storage `<recording_id>/meta.json` (Slice 4). Ingest merges them.

### Slice 3 — hooks and redaction (`packages/capture`, `packages/cli/src/init.ts`)

| Consumes | Provided by |
|---|---|
| `Event`, `TestPayload`, `FileEditPayload`, `HookPayload` | `event.ts` (Tech Lead may change) |
| Hook probe facts | `plans/hook-probe-report.md` |

Missing: a write API. Decision: Slice 3 owns its own appender in `packages/capture`; it needs no core runtime code. Redaction runs before append; strip any value equal to an env secret (`SUPABASE_*`, `ANTHROPIC_*`, `sk-`). The hook must never read `.env`. Raw `tool_response.originalFile` stays out of `raw` unless redacted. Add `.devlens/` to `.gitignore` (C3).

### Slice 4 — recorder (`apps/web/record`, `apps/web/api/recordings`, `packages/core/src/sync.ts`)

| Consumes | Provided by |
|---|---|
| `RecordingMeta`, `PauseSpan`, `RecordingGrant`, `Event` | `event.ts` |
| Supabase admin client | Slice 4 builds its own in the route (server only) |

Upload design (decided):
1. `POST /api/recordings` body `{mode:'window'|'desktop', consent:true}`. Server rejects without `consent:true`. Server makes `recording_id` (uuid) and path `<recording_id>/take.webm`, then `createSignedUploadUrl(path)`. Returns `RecordingGrant`. The client never chooses the path.
2. Client uploads with `uploadToSignedUrl(path, token, blob)` using only the publishable key. Observed: token is bound to its path (7200 s).
3. `POST /api/recordings/<id>/meta` body `RecordingMeta` (without `recording_ref`). Server validates `audio_tracks===0`, `video_tracks===1`, window mode ⇒ `display_surface!=='monitor'`, pauses ordered and inside `[wall_start_ms, wall_end_ms]`. Server writes `<recording_id>/meta.json` (service role, no upsert). The route writes **no DB rows**.
4. `recording_ref` = `<recording_id>/take.webm`. Replay signs it server-side only from an RLS-visible event row.

`sync.ts` signature (Slice 4 owns): `mediaOffsetMs(tsMs: number, m: Pick<RecordingMeta,'wall_start_ms'|'wall_end_ms'|'pauses'>): number | null` (null before start, after end, or inside a pause) and `attachMedia(events: Event[], m: RecordingMeta): Event[]` (sets `recording_ref` and `media_offset_ms`; null otherwise). Slice 5 does **not** import it; Slice 6 wires `attachMedia` into `link`.
Wrappers: Slice 4 may add only `apps/web/app/record/page.tsx` and `apps/web/app/api/recordings/**/route.ts` (one-line re-exports; C2).

### Slice 5 — linker and re-run (`packages/link/src/rules.ts`, `rerun.ts`, `packages/cli/src/link.ts`, `rerun.ts`)

| Consumes | Provided by |
|---|---|
| `Event`, `Edge`, `LinkRule`, `TestPayload`, `FileEditPayload` | `event.ts` |
| Fixture events for tests | `examples/broken-api/fixtures/session.jsonl` (read only) |

- Rules are `LinkRule`: pure, no I/O. Input comes from real hooks, so test events have **no** `files` or `patch_event_id`. The real rule 5 must derive: a failed `test`, then `file_edit` events, then a later passed `test` with the same `command` ⇒ `verifies` (dst = last edit between) and `supersedes`. `derived_by` = rule id. `provenance:'inferred'`. `linkTracer` stays for the fixture and `test:tracer`; do not delete it.
- Edge id: `<rule_id>:<src>:<dst>` (deterministic).
- Re-run: writes one `Event` per run to `.devlens/rerun.jsonl`: `source:'sandbox'`, `actor:'ci'`, `type:'test'`, `provenance:'observed'`, `payload: TestPayload` with `signal:'rerun'`, `rerun_of: <session test event id>`. Page tells session output from re-run by `source`.
- `packages/cli/src/link.ts` owns the Supabase writer (service role, server env only), session replace-write, and refuses a project host other than `hivfaqlabtbrhrviwrrm.supabase.co` (same guard as `ingest.ts`).
- Re-run child env must be an allowlist (C6).

## Duplicate route wrappers (item 7)

- **Canonical:** `apps/web/api/replay/**` and `apps/web/replay/page.tsx` (the slice-named files).
- **Wrappers:** `apps/web/app/replay/page.tsx`, `apps/web/app/api/replay/route.ts`, `.../media/route.ts`. They exist only because Next serves `apps/web/app/**`. They are one-line re-exports.
- Rule: never put logic in a wrapper. `runtime`/`dynamic` exports cannot be re-exported (Slice 1 F3), so declare `export const runtime = 'nodejs'` literally in the wrapper.
- No consolidation now; moving files would break the Slice 1 Files lists and `tracer.test.ts` (reads `apps/web/replay/page.tsx`).

## Conditions before Wave 3 (Tech Lead, not builders)

| ID | Condition |
|---|---|
| C1 (DONE by Tech Lead) | Add scripts to `package.json` for the three slices (`test:capture`, `probe:claude-hook`, `test:sync`, `test:record`, `test:link`, `test:rerun`) before launch, so builders do not edit one file concurrently. Any new dependency is installed by the Tech Lead once. |
| C2 (DONE by Tech Lead) | Amend Slice 4 Files with the two wrapper paths above. |
| C3 (DONE by Tech Lead) | Add `.devlens/` to `.gitignore` (raw, unreviewed events). |
| C4 | Slice 4 gates `POST /api/recordings` (same-origin check; env flag `DEVLENS_RECORD_ENABLED=1`). Tech Lead sets a bucket `file_size_limit` and `allowed_mime_types` by a new migration once the plan limit is known (not applied here). |
| C5 | Before Slice 6/7: a new migration adds a published-session allowlist (for example `public_sessions(session_id)` with RLS on, SELECT-only for anon, and `events`/`edges` policies keyed to it, with `revoke insert,update,delete` and `enable row level security` in the same file). Supabase grants new `public` tables to `anon` by default; a table without RLS would be open. Also order `loadReplay` by `(ts, seq)` and raise the signed TTL (A5). |
| C6 | Slice 5 re-run: scrubbed child env (no `SUPABASE_*`, no `ANTHROPIC_*`), temp copy of the repo, wall-clock timeout, output size cap. The hook (Slice 3) and the recorder page never receive the secret key. |

## Commands run (masked)

| Command | Result |
|---|---|
| `node /tmp/dl-rls.mjs` (anon + service role, temp rows) | anon select 5/1/1; after temp insert still 5/1/1; temp session 0 rows; anon ins/upd/del `42501` ×9; storage list `[]`, upload RLS error, download/sign "Object not found", public URL 400; cleanup ok; counts 5/1/1; root bucket list `[tracer-fixture-1]` |
| `node /tmp/dl-sign.mjs` | secret in URL: false; claims `url,scope,iat,exp`; 3 s URL: 206 then 400 `InvalidJWT` after 5 s; prod TTL 120 s; tampered path 400; public/authenticated/plain URLs 400; anon signed-upload RLS error; token other path "Invalid signature"; test object removed |
| SQL (`has_table_privilege`, `pg_policies`, `storage.buckets`) + `get_advisors security` | ins/upd/del false for anon+authenticated; 3 SELECT policies; no storage policy; `recordings public=false`; 0 lints |
| `npm run build && npm run check:bundle` | build ok; PASS no credential name or value in client assets |
| `grep -rlF <secret> apps/web/.next` | 0 hits; `/api/replay` body 0 hits |
| `next start` live env vs `NEXT_PUBLIC_SUPABASE_URL=https://127.0.0.1:1` | `supabase` + signed URL (GET 206) vs `local fixture` + warning |
| `git grep` secret pattern over all commits | none |
| After the `event.ts` edit: `npm run check && npm run test:tracer && npm run demo:smoke` | check ok; 4/4 tests; 6/6 smoke PASS |

DB state left: 5 events, 1 edge, 1 entity, 1 Storage object (`tracer-fixture-1/session.webm`). Temp rows and temp object removed.

## Not verified

- Authenticated-role JWT behaviour (grants checked by SQL; no logged-in token was minted).
- A real network timeout to a valid Supabase host.
- Visual rendering of Replay in a browser.
- All conditions C1–C6 are open.
