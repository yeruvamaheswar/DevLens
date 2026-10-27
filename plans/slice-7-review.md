# Slice 7 review (commit d5fc6b5)

Reviewer: fresh Claude Sonnet 5.5 session. Read-only. This review does not mark the slice VERIFIED. Tech Lead decides.

## Verdict: PASS WITH FINDINGS

All commands pass. The click check passes in both modes. No forbidden verdict content on the replay page. Findings are about labeling precision, accessibility, and exposure policy. None blocks the golden demo.

## 1. Commands (exact output, exit codes)

| Command | Exit | Output |
|---|---|---|
| `npm run check` | 0 | `tsc --noEmit`, no output |
| `npm run test:replay` | 0 | 3 files, 7 tests passed |
| `npm run demo:smoke` | 0 | PASS: replay fixture / WebM fixture header / Supabase fixture / RLS insert denial / signed private media |
| `npm run demo:smoke -- --offline` | 0 | PASS: replay fixture / PASS: WebM fixture header / SKIPPED(offline requested): Supabase fixture, RLS insert denial, signed private media |
| `npm run fixture:verify -- broken-api` | 0 | `PASS` |
| `npm run test:link` | 0 | 13 tests passed |
| `npm run test:sync` | 0 | 8 tests passed |

Note: `demo:smoke` does not exercise the page, the `/api/replay` view, or the signed URL playing. The click check below covers that.

## 2. Browser click check

Tool: T3 preview tab, driven with page JavaScript. `preview_snapshot` timed out three times on a hidden tab, so no live screenshot exists. I read the DOM and `video.currentTime`. I extracted the real frames from `session.webm` with ffmpeg.

| Step | `/replay` (supabase) | `/replay?offline=1` (local fixture) |
|---|---|---|
| Header label | `golden take, broken-api, 2026-10-27 · supabase` | `... · local fixture` |
| Video src | signed `hivfaqlabtbrhrviwrrm.supabase.co/storage/v1/object/sign/recordings/...` | `/api/replay/media` |
| Click "failed test" | `currentTime` 30.446 | 30.446 |
| Click "passing test" | `currentTime` 177.918 | 177.918 |
| Decoded frame after seek | 2462x1582, player box 960x617 | same |
| Status text | `Player time is 30.4 seconds.` then `177.9` | same |

- Both modes returned identical `edges`, `claim`, `questions`, `unknowns`, `not_captured`. `events` differ only in `ts` format (`+00:00` vs `Z`).
- One page shows: failed test with output, "Question and answer" (says no answer captured), later edits, commit diffs (first-fix, final-fix), later failed tests, passing test, separate "Worker re-run" section, rules, 3 questions with event ids, 7 unknowns, 5 not-captured items.
- The video shows the terminal, not a blank frame. Frames at 30.4 s and 177.9 s (ffmpeg, `/tmp/rv/f30.png`, `/tmp/rv/f177.png`) show the Claude Code window. At 30.4 s the screen shows the prompt and "Fiddle-faddling", not the failing assertion. At 177.9 s it shows "Update(src/client.js)", not the pass. This is the known collapsed-output limit in the golden README. The page does not warn at click time.

## 3. Honesty and labeling

- No developer question or answer is invented. `answer_note` = "No developer answer was captured in this take." Repeated in Unknowns. PASS.
- Worker re-run is a separate bordered section, id `sandbox:...`, origin "worker re-run", "No recording offset". It is not merged into the session test line. PASS.
- Commit diffs are labeled "commit diff, from git, not from the hook log". PASS.
- "What the model said: not captured in this take." PASS.
- Questions are labeled "Origin: rule derived, rule-qN-...-v1. No model call." Each cites 3 event ids. PASS.
- Concerns: see findings F1, F2, F3, F4.

## 4. Forbidden content (NOT-1)

- Rendered page HTML, `/api/replay`, `/api/replay?offline=1`: regex `score|rank|grade|hire|hiring|verdict|cheat|competen|recommend|suspicious|plagiar|rating|trust` matched nothing. Page HTML is a client shell, so I also read the full `document.body.innerText` in the browser in both modes. None found.
- `apps/web/**` source: matches only in `apps/web/record/page.tsx:29` (`<li>A score</li>`, a list of things DevLens does not do, on `/record`), and in tests that assert the words are absent. None on the replay page.
- Only "Nothing here predicts job performance." appears, as required by REQ-10.

## 5. Exposure

What an anonymous visitor receives from `GET /api/replay` (200, `Cache-Control: no-store`, no auth, about 52 KB):
- 31 events with payloads (prompts, tool outputs, edits), 32 edges, claim, questions, unknowns, and a signed URL.
- Keys: grep for `sb_secret`, `sb_publishable`, `service_role`, `apikey`, `password`, emails found none. Only two JWT-like strings, both inside the signed URL token (header and payload).
- Signed URL token payload, decoded: `{"url":"recordings/d4ce73f0-.../take.webm","scope":"download","iat":1793121896,"exp":1793123696}`. It is scoped to one object, download only, and expires after 1800 s. PASS.
- Personal data: `/Users` appears 0 times in the API JSON (paths are redacted to `[path]`). The recording footage shows a `/private/var/folders/...` temp path and the terminal title. The author consented.
- `/api/replay/media` takes no path input. It always reads `goldenFile('session.webm')`. GET results (Range 0-100): `?path=../x` 206, `?path=other/file.webm` 206, `?path=%2e%2e%2fsecret` 206, `?object=x` 206, `?ref=recordings/../../x` 206, all the same golden bytes (query ignored). `/api/replay/media/..%2f..%2fetc` 404. No other object is reachable. PASS.
- Server uses `SUPABASE_SECRET_KEY` (service role) in `packages/core/server.ts` to read events and sign. The key is not in any response. `page.test.ts` asserts the page source does not name it.

## 6. Edge cases (code read; env not changed)

- Env missing, or Supabase read or signing fails: `loadReplay` catches and returns the local replay with warning "Supabase unavailable; using local golden files." Mode shows `local fixture`. Good, labeled.
- `?offline=1` never touches Supabase. Page checks `has('offline')`, so `?offline=0` also goes offline in the API call (`offline=1`). Minor.
- Video load error: `onError` replaces the status line with "Media unavailable. Reload to refresh the short-lived URL." The evidence stays on screen. Good. The signed URL expires after 30 min with no auto refresh.
- Local `session.webm` missing: `/api/replay/media` throws an unhandled 500; page shows the status message above. Local `meta.json` or `rerun.jsonl` missing: `/api/replay` fails, page shows only "Replay unavailable. Restart the local demo." with no evidence. Not run, read only.
- Golden event ids must match local ids or Supabase mode silently falls back to local. The fallback is labeled by warning and mode.

## 7. Accessibility

- Both claim buttons are `<button type="button">`. Programmatic `focus()` works and `click()` seeks. Real Tab and Enter keys NOT tested (preview tool cannot do it reliably).
- Status: `<p role="status">` announces seek updates. PASS.
- State does not depend on color. PASS.
- `<video>` has no `aria-label` or `title`. FAIL (F5).

## Findings

| # | Sev | Where | Observed | Reproduce | Recommendation |
|---|---|---|---|---|---|
| F1 | Medium | `apps/web/replay/view.ts` `commitGroups` | The first-fix and final-fix diffs are paired to edit events by session order (`later[Math.min(index, ...)]`). The page prints "Event ids: ..." under each commit as if recorded. The pairing is an inference, and the README says the commits were made outside the sessions. | Read page text under each diff. | Label it "paired by session order, inferred" or drop the event-id line. |
| F2 | Medium | `/api/replay` `edges[].provenance`; page "Rules" | Rule edges `supersedes` and `verifies` (rule-5) show `observed`, next to "What a rule derived". A rule-derived link is shown as observed. Only `failed` shows `inferred`. This is the linker's value (slice 5), but the page repeats it without explanation. | `curl localhost:3000/api/replay`, read `claim.rules`. | Show "rule derived, observed evidence" wording, or explain the term on the page. |
| F3 | Low | `apps/web/questions.ts:94` (Q3) | Q3 says "A file changed with no hooked event. Call it unattributed", while Unknowns says "no file-edit event is unattributed", and the cited ids are hooked edits. Q2 and Q3 are statements, not questions. | Read Questions and Unknowns. | Rewrite as questions. Remove the "unattributed" contradiction. |
| F4 | Low | `/replay` after click | Seek lands on the terminal, but at 30.4 s and 177.9 s the failing and passing output is not on screen. | Click either button, look at the frame. | Add one line: "Output may be collapsed on screen. The log text below is the evidence." |
| F5 | Low | `apps/web/replay/page.tsx` `<video>` | No accessible name. | Inspect video attributes. | Add `aria-label="Recording of the Claude Code terminal"`. |
| F6 | Medium (policy) | `GET /api/replay` | No auth, no rate limit. Any visitor can mint a 30-min signed link to the private recording and read all event payloads. The bucket stays private, but the page makes it public in effect. The author consented. | `curl localhost:3000/api/replay`, open `media.url`. | Tech Lead and Uma decide whether public exposure is accepted for the demo. Record it. Shorten the expiry if possible. |
| F7 | Low | `apps/web/api/replay/media/route.ts` | Reads the whole file per request, no try/catch. | Read code. | Optional for a demo. |
| F8 | Low | `page.tsx` effect | `?offline=0` is treated as offline. | Load `/replay?offline=0`. | Check the value. |

## Slice 7 accept criteria

- Click seeks the real WebM: PASS (30.446 s and 177.918 s, both modes, decoded 2462x1582).
- Shows failure: PASS.
- Shows answer: PASS (honestly reports none captured, no invention).
- Shows later edit: PASS (3 edits plus 2 commit diffs; see F1).
- Shows pass: PASS.
- Shows separate re-run: PASS.
- Three questions cite ids: PASS (3 each; see F3 for wording).
- Unknowns visible: PASS.
- Not-captured limits visible: PASS.
- Supabase and offline show same chain: PASS (identical claim, edges, questions, unknowns).
- Correct labels: PASS WITH FINDINGS (mode label and warning differ correctly; F1, F2).
- Verify: test:replay, demo:smoke, demo:smoke --offline: PASS.
- Forbidden verdict search: PASS.
- Fresh reviewer claim click: PASS (page JS, not a screenshot).

## Not checked

- A live browser screenshot (tool timed out).
- Real Tab and Enter keyboard events.
- `npm run demo` itself, a second launch with env missing, a failing signed URL, and URL expiry after 30 minutes.
- Playback of the full video at normal speed.
- Supabase RLS or the bucket policy directly (no Supabase access used).
- A narrow viewport or mobile layout.
