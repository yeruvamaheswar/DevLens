# Slice 4 review: consented window recorder

Reviewer: independent session (Claude Sonnet 5.5). Builder files were read, not trusted. No repo code was edited. The one authorized edit was made: two lines appended to `.env.example`.

**Verdict: VERIFIED-WITH-GAPS.** All automated and live-server checks pass. The real window picker and WebM playback are NOT_RUN. A human must do the checklist below. Gaps are listed after the table.

## Results

| # | Check | Result | Evidence (masked) |
|---|---|---|---|
| 1a | `npm run check` | FAIL (not Slice 4) | 3 errors, all in `packages/link/src/rerun.ts`, `packages/link/tests/rerun.test.ts`, `packages/link/tests/rules.test.ts`. Zero errors in Slice 4 files. |
| 1b | `npm run test:sync` | PASS | 1 file, 8/8 tests |
| 1c | `npm run test:record` | PASS | 6 files, 24/24 tests |
| 1d | `npm run build && npm run check:bundle` | PASS | build ok; routes `/record`, `/api/recordings`, `/api/recordings/[id]/meta`; "PASS: no server credential name or configured value in client assets". `next-env.d.ts` restored by `git checkout`. |
| 2 | sync.ts adversarial (`/tmp/s4/adv.ts`, 31 assertions) | PASS with 2 defensive gaps | See S4-1 and S4-2. 5 s pause excluded (14000); two pauses; pause start null, resume start counts as media time; before start, after end, in pause null; open take ok; NaN, negative, Infinity, inverted pause null; `attachMedia` does not mutate and sets `recording_ref` only when offset is non-null. |
| 3 | Recorder logic (code read) | PASS with gaps | See below. |
| 4a | Flag unset: both POST routes | PASS | grant 403, meta 403 (valid Origin sent) |
| 4b | Flag on: missing, foreign, `null` Origin | PASS | 403 on grant and meta |
| 4c | `consent` false, string "true", no body | PASS | 400, 400, 400 |
| 4d | Desktop mode | PASS | 400 "window mode is required" (grant and meta) |
| 4e | Meta validation | PASS | id mismatch, audio 1, video 2, monitor, missing consent, open take, bad surface, end<start, bad UUID, `..%2Fx` URL: all 400. Pause outside take, before start, unordered, overlapping, zero-length: all 400. |
| 4f | Foreign Supabase host | PASS | `NEXT_PUBLIC_SUPABASE_URL=https://evil.supabase.co`: grant 403 and meta 403 "storage unavailable" |
| 4g | Secret key not exposed | PASS | grant body: false; `apps/web/.next/static`: 0 files; `/record` HTML: 0 hits |
| 5a | Live grant | PASS | 200, keys `recording_id,path,token`. Body `path:"evil/x.webm"` and a client `recording_id` were ignored. |
| 5b | Upload with publishable key only | PASS | `uploadToSignedUrl` ok, 43704 B fixture WebM |
| 5c | Meta POST | PASS | 200; repeat POST 502 (no upsert) |
| 5d | Storage state | PASS | SQL: `recordings/<id>/take.webm` (43704, video/webm) and `<id>/meta.json` (348, application/json); bucket `public=false`. `meta.json` has `recording_ref` = `<id>/take.webm`. |
| 5e | Anon cannot read | PASS | list `[]`; download and createSignedUrl "Object not found"; public URL 400 (both objects) |
| 5f | Ungranted path fails | PASS | token on another path: "Invalid signature"; plain anon upload: RLS violation; token reuse: "already exists" |
| 5g | No DB rows | PASS | events/edges/entities = 5/1/1 |
| 5h | Cleanup | PASS | service-role remove ok (2); SQL confirms bucket holds only `tracer-fixture-1/session.webm`. |
| 6a | `/record` load | PASS | Page shows only the Start button, 0 `<video>`. Code read: `getDisplayMedia` appears only in `session.start()`. |
| 6b | Consent text | PASS | "Captured" and "Not captured" lists match `docs/implementation.md` lines 139–144 |
| 6c | Forbidden wording | PASS | "A score" appears only in the Not captured list. No rank or hire wording. |
| 6d | Permission prompt on load | PASS (partial) | No prompt seen. Permission state read only after load (camera, microphone, display-capture "denied" in this headless tab). A load-time call spy was not possible. |
| 6e | Real window picker, monitor discard, playback | NOT_RUN | Needs a human. See checklist. |
| 7a | Scope | PASS | Slice 4 paths only: `apps/web/record/`, `apps/web/api/recordings/`, `packages/core/src/sync.ts` (+test), the two wrappers. No tracked file modified except `.env.example` (authorized). |
| 7b | Wrappers | PASS | `app/record/page.tsx` is a one-line re-export. Route wrappers are one re-export plus literal `export const runtime = 'nodejs'`. |
| 7c | Dependencies | PASS | `package.json` not modified. |

## Recorder logic (item 3, code read)

| Requirement | Finding |
|---|---|
| `getDisplayMedia` only on Start click | Only caller is `session.start()` (`session.ts:123`), triggered by the button. Not called in render or effects. |
| `video:true, audio:false`; no `getUserMedia` | `DISPLAY_CONSTRAINTS`. No `getUserMedia` in `apps/web` source. |
| Monitor discarded in window mode | `assessTracks` rejects it. Tracks are stopped and the phase returns to idle. |
| Discard on any audio track, facingMode (camera), or video count ≠ 1 | Yes (`tracks.ts:22-31`). |
| `wall_start_ms` at `MediaRecorder.start()` | `deps.now()` is read immediately before `created.start()`. The gap is sub-millisecond. |
| Pause/resume spans | `pauseTake`/`resumeTake`; timestamps are read after the recorder call. Zero-length spans are dropped. |
| Stop and track `ended` close the take | Both go through `stop()`. A stop while paused closes the open span. `ended` is bound to the video track. |
| Review before upload; delete uploads nothing | Delete is only allowed in `review`. It revokes the object URL and does not call `upload`. Upload is a separate button and calls the grant route only then. |
| Double-click Start | Guarded: the phase is `arming`, so a second call returns and the button is disabled. |
| Resume after ended | `resume()` requires phase `paused`. After `stop()` the phase is `review`, so it is a no-op. |

## Findings

| ID | File | Consequence | Fix | Severity |
|---|---|---|---|---|
| S4-1 | `packages/core/src/sync.ts:12-17` | A pause that starts before `wall_start_ms` subtracts its whole length, not just the part inside the take (ts 5000, pause 500–3000, start 1000: returns 1500, correct 2000). The server rejects such pauses and the recorder cannot produce them, so it is not reachable today. | Clamp each span to `[wall_start, min(resume, ts)]`, or document "meta is validated". | Low |
| S4-2 | `packages/core/src/sync.ts:12-17` | Overlapping pauses are summed, not unioned (10–20k and 15–25k at ts 40000: 19000, correct 24000). Unsorted input is fine. The server rejects overlaps, so it is not reachable today. | Merge spans before summing. | Low |
| S4-3 | `apps/web/record/tracks.ts:17-30`, `gates.ts:4` | Window mode accepts `display_surface` `browser` (tab share) and `unknown`. The docs only require a `monitor` discard. A browser-tab take is labeled `browser` in meta but is not rejected. Some browsers report `unknown`, so rejecting it could block valid takes. | Tech Lead decides: accept `browser` (current) or require `window`. Replay should show the surface. | Low (decision) |
| S4-4 | `apps/web/api/recordings/handler.ts:57-85` | The meta route does not check that the recording id was granted or that `take.webm` exists. With the flag on, an allowed-origin caller can write a `meta.json` for any UUID once. The route writes no DB rows. | Check that `<id>/take.webm` exists before writing meta. | Low |
| S4-5 | `apps/web/record/upload.ts:50-73` | If the upload succeeds but the meta POST fails, Retry fetches a new grant, which leaves an orphan `take.webm`. | Reuse the grant on retry, or clean up orphans. | Low |
| S4-6 | `apps/web/api/recordings/gates.ts:10-21` | The origin check compares `Origin` with the `Host` header. A proxy that rewrites `Host` would produce 403s (fail closed). Anyone with a matching Origin still gets unlimited grants. The size/MIME bucket limit (C4, Tech Lead migration) is not applied. | Tech Lead: apply the C4 migration. Keep the flag off on any public host. | Low (known A17) |
| S4-7 | `npm run check` | Fails with 3 type errors in Slice 5 files (`packages/link`). | Slice 5 builder fixes it; it is not a Slice 4 defect. | Info |
| S4-8 | `plans/devlens.contract.md` REQ-14 | The page lists "A score" under Not captured. REQ-14 asks for "reasoning, the editor, other terminals". The page matches `docs/implementation.md`, not REQ-14. | Tech Lead decides on the text. | Info |

## Manual human checklist (2 minutes, real Chrome)

1. Run `DEVLENS_RECORD_ENABLED=1 npm run build && DEVLENS_RECORD_ENABLED=1 npx next start apps/web`, then open `http://localhost:3000/record`.
2. Load the page. Expect no permission prompt and no sharing indicator.
3. Click **Start recording**. In the picker choose **Entire Screen**. Expect the take to be discarded and the message "That share was the whole screen…". Expect no recording.
4. Click Start again and choose one **Window** (the code editor). Expect "Recording the chosen window…" and a sharing indicator. Expect no microphone or camera prompt.
5. Click **Pause**, wait 5 s, click **Resume**. Click **Stop**. Expect a `<video>` preview with controls.
6. Play the preview. Expect the chosen window to be visible, with a short skip or freeze, and no audio.
7. Click **Delete**. Expect "Take deleted. Nothing was uploaded." and no new object in Storage.
8. Repeat steps 4–5, then click **Upload**. In Supabase Storage (bucket `recordings`, private) expect `<id>/take.webm` and `<id>/meta.json`. Check that `meta.json` has `audio_tracks:0`, `video_tracks:1`, one pause of about 5000 ms, and `display_surface:"window"`.
9. Start a take and stop sharing from the browser's "Stop sharing" bar. Expect the take to close and move to review.
10. Delete the test objects (service role) afterwards.

## Reproduce

`/tmp/s4/adv.ts` (sync cases), `/tmp/s4/live.mjs` (live grant → upload → meta → anon denials), `/tmp/s4/clean.mjs` (cleanup). These are outside the repo and are not committed.
