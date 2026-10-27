# Slice 9 review: desktop recording mode

Independent review of commit `329a75b55f10236d7aeab50f34845a54ffed959c` ("Add desktop recording as a second explicit opt-in"), parent `6d4e788f3838a5eacad415426b1f8236404dbe9d`. This session did not build the slice.

**Verdict: PASS WITH FINDINGS.** The slice is not VERIFIED.

The desktop opt-in is a separate button and a separate session function. Window mode still discards a declared monitor. Neither mode asks for audio, a camera, or keystroke timing. The record page still tells the developer that the whole desktop is not captured, on the same screen as the desktop opt-in.

Reviewed on 2026-10-27. No commit, push, install, or Supabase write. `.env` was not opened. `apps/web/replay/` and `apps/web/questions.ts` were not reviewed.

## What was reviewed

`git log --oneline -3 -- apps/web/record` showed:

```text
329a75b Add desktop recording as a second explicit opt-in.
caa6227 Add the consented window recorder and cap the recordings bucket.
```

`329a75b` is the newest commit that touches `apps/web/record/` and `apps/web/api/recordings/gates.ts`. The working tree matched HEAD for those paths before this report. The commit changes 12 files: `gates.ts`, the record page, session, take, upload, README, and their tests. `tracks.ts`, `browser.ts`, and `handler.ts` are unchanged.

Contract checks read: REQ-2, REQ-18, NOT-2, EVAL-2, EVAL-18. Slice 9 Accept: desktop requires its own click; a monitor take is kept and labeled desktop; window mode still discards a monitor; neither mode records audio or camera.

## 1. Commands

Both commands were run in `/Users/UmaYeruva/Code-Git-Repos/DevLens` on 2026-10-27. Exit code 0 for each.

`npm run check`

```text
> check
> tsc --noEmit
```

`npm run test:record`

```text
> test:record
> vitest run apps/web/record

(node:70553) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens

(node:70560) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:70557) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:70559) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:70558) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:70561) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:70556) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ apps/web/record/page.test.ts (2 tests) 6ms
 ✓ apps/web/record/take.test.ts (5 tests) 3ms
 ✓ apps/web/record/tracks.test.ts (4 tests) 3ms
 ✓ apps/web/record/session.test.ts (11 tests) 6ms
 ✓ apps/web/record/upload.test.ts (4 tests) 19ms
 ✓ apps/web/record/gates.test.ts (7 tests) 24ms

 Test Files  6 passed (6)
      Tests  33 passed (33)
   Start at  12:44:40
   Duration  305ms (transform 48%, import 41%, tests 8%, worker 2%)
```

The `NO_COLOR` lines come from the shell environment. Vitest reported 33 passed tests.

## 2. Safeguard regression

Window mode is intact.

| File | Old behavior that remains | What this commit adds |
|---|---|---|
| `take.ts` | `idleTake()` and the default `startTake` argument are `mode: 'window'`. | `startTake` stores an explicit mode. `metaFromTake` writes `take.mode`. A window start still passes `'window'`. |
| `tracks.ts` | Unchanged from the parent. `assessTracks(..., 'window')` still returns `reason: 'monitor'` for `displaySurface: 'monitor'`. Audio, any truthy `facingMode`, and a video count other than 1 are still rejected. | No edit. Desktop acceptance of a monitor was already in this file. |
| `session.ts` | `start()` calls `arm('window')`. Constraints stay `{ video: true, audio: false }`. A rejected share stops every track and creates no recorder. | `startDesktop()` calls `arm('desktop')`. The old `start` body moved into `arm`. `stop` and `dispose` call the same stop helper. |
| `upload.ts` | A window take still posts `{ mode: 'window', consent: true }`. `upload.test.ts` still asserts that exact body. | The grant body uses `input.take.mode`. |
| `gates.ts` | Consent must be `true`. `audio_tracks` must be `0`. `video_tracks` must be `1`. | `mode` may be `window` or `desktop`. A monitor is rejected only when `mode` is `window`. |

`git show 329a75b -- '*.test.ts'` deletes one assertion:

```diff
-    expect((await postGrant(request('/api/recordings', { mode: 'desktop', consent: true }), deps)).status).toBe(400);
+    expect((await postGrant(request('/api/recordings', { mode: 'screen', consent: true }), deps)).status).toBe(400);
+    expect((await postGrant(request('/api/recordings', { mode: 'desktop', consent: false }), deps)).status).toBe(400);
```

That removal is justified. Desktop with `consent: true` is now a valid grant. The same test still rejects a missing mode and a desktop grant without consent. The new test `grants a consented desktop take and stores a monitor as desktop` expects status 200 for `{ mode: 'desktop', consent: true }`. No other test assertion was removed or loosened. The builder's report of this one change matches the diff.

Unchanged limit: window mode keeps a single video track whose `displaySurface` is missing, and records it as `unknown` (`tracks.ts` lines 17–29). This commit does not change that path. A real browser that omits `displaySurface` on a monitor share was not checked.

## 3. Server rules

Direct in-process calls of `postGrant` and `postMeta` with an in-memory `StoragePort`. No network and no Supabase. The same rules live in `gates.ts` lines 41–46 and 71–84. `handler.ts` stores `parsed.meta` plus `recording_ref`.

Answers:

- A client cannot store `mode: 'window'` with `display_surface: 'monitor'`. Status 400, error `a full-screen share cannot be stored in window mode`. Nothing is written.
- A client cannot store `mode: 'desktop'` without `consent: true`. Missing consent and `consent: false` are 400 on both the grant and the meta write.
- A client cannot store `audio_tracks` other than `0`, or `video_tracks` other than `1`. Values `1`, `2`, a missing field, and the strings `"0"` / `"1"` are 400. The string case fails on the audio check first because `"0" !== 0`.
- A declared monitor cannot be stored as a window. A declared window can be stored with `mode: 'desktop'`. The stored `display_surface` stays `window`, so that write does not relabel a monitor as a window. The grant does not record the mode. The meta write is checked on its own, and a desktop monitor meta is stored as desktop.

The server does not open the WebM. A client that sends `display_surface: 'window'` can store whatever bytes the signed upload accepts. That limit already existed for window mode.

Probe output, one JSON object per call:

```text
{"name":"grant desktop consent","request":{"mode":"desktop","consent":true},"status":200,"error":null,"stored":null}
{"name":"grant desktop no consent","request":{"mode":"desktop","consent":false},"status":400,"error":"consent is required","stored":null}
{"name":"grant desktop missing consent","request":{"mode":"desktop"},"status":400,"error":"consent is required","stored":null}
{"name":"grant window consent","request":{"mode":"window","consent":true},"status":200,"error":null,"stored":null}
{"name":"grant screen consent","request":{"mode":"screen","consent":true},"status":400,"error":"a recording mode is required","stored":null}
{"name":"meta window + monitor","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"window","display_surface":"monitor","consent":true,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"a full-screen share cannot be stored in window mode","stored":null}
{"name":"meta desktop + monitor","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":200,"error":null,"stored":{"mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":0,"video_tracks":1}}
{"name":"meta desktop monitor consent false","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":false,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"consent is required","stored":null}
{"name":"meta desktop monitor missing consent","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"consent is required","stored":null}
{"name":"meta desktop audio 1","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":1,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"audio tracks must be absent","stored":null}
{"name":"meta desktop audio 2","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":2,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"audio tracks must be absent","stored":null}
{"name":"meta desktop audio missing","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"audio tracks must be absent","stored":null}
{"name":"meta desktop video 0","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":0,"video_tracks":0,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"the take must contain one video track","stored":null}
{"name":"meta desktop video 2","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":0,"video_tracks":2,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"the take must contain one video track","stored":null}
{"name":"meta desktop video missing","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":0,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"the take must contain one video track","stored":null}
{"name":"meta desktop + window surface","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"window","consent":true,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":200,"error":null,"stored":{"mode":"desktop","display_surface":"window","consent":true,"audio_tracks":0,"video_tracks":1}}
{"name":"meta window + window surface","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"window","display_surface":"window","consent":true,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":200,"error":null,"stored":{"mode":"window","display_surface":"window","consent":true,"audio_tracks":0,"video_tracks":1}}
{"name":"meta desktop + browser","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"browser","consent":true,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":200,"error":null,"stored":{"mode":"desktop","display_surface":"browser","consent":true,"audio_tracks":0,"video_tracks":1}}
{"name":"meta desktop + unknown","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"unknown","consent":true,"audio_tracks":0,"video_tracks":1,"wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":200,"error":null,"stored":{"mode":"desktop","display_surface":"unknown","consent":true,"audio_tracks":0,"video_tracks":1}}
{"name":"meta string audio and video counts","request":{"recording_id":"00000000-0000-4000-8000-000000000001","mode":"desktop","display_surface":"monitor","consent":true,"audio_tracks":"0","video_tracks":"1","wall_start_ms":1000,"wall_end_ms":20000,"pauses":[{"pause_ms":5000,"resume_ms":10000}],"bytes":32},"status":400,"error":"audio tracks must be absent","stored":null}
```

## 4. Client flow

`page.tsx` creates the session in `useState` and the effects only subscribe and dispose. `getDisplayMedia` is called from `session.ts` line 138, only inside `arm`, which runs from a button.

- Desktop capture starts from the desktop button's `onClick`, which calls `session.startDesktop()` (`page.tsx` lines 45–46). `start()` ignores extra arguments and calls `arm('window')` (`session.ts` lines 210–214). There is no path from the window button to desktop mode.
- A window start that receives a monitor track stops that track, creates no recorder, and stays idle. The probe result is below. A desktop start with the same track reaches review with `mode: 'desktop'` and `displaySurface: 'monitor'`.
- `getDisplayMedia` is called with `{ video: true, audio: false }`. The dependency type allows only `audio: false`. There is no `getUserMedia` under `apps/web/record/`. An audio track, or a video track with any truthy `facingMode`, is discarded in both modes. The probe used `facingMode: 'environment'` and the take was discarded.
- A search of `apps/web/record` and `apps/web/api/recordings` found no `keydown`, `keyup`, `keypress`, `onKey`, `keystroke`, or `KeyboardEvent` handler.
- The desktop consent text says the three required things (`page.tsx` lines 35–36): a monitor take can show other windows and notifications; audio and camera stay off; the developer can delete the take before upload. The same three sentences are the desktop arming message (`session.ts` lines 132–133).
- During review, the page prints `Take mode: {snap.mode}` and `Captured surface: {snap.displaySurface}` (`page.tsx` lines 61–62). A desktop monitor also prints "This monitor take is labeled desktop." (line 64).

The static consent lists contradict that text. See the findings table.

Client probe, same in-memory session, no browser:

```text
{"name":"window start keeps a window","call":"start","constraints":[{"video":true,"audio":false}],"created":1,"stoppedAfterStart":[false],"phase":"review","mode":"window","displaySurface":"window","message":"Play the take or delete it. Upload is a separate step."}
{"name":"window start discards a monitor","call":"start","constraints":[{"video":true,"audio":false}],"created":0,"stoppedAfterStart":[true],"phase":"idle","mode":"window","displaySurface":null,"message":"That share was the whole screen. Choose one window and start again."}
{"name":"desktop start keeps a monitor","call":"startDesktop","constraints":[{"video":true,"audio":false}],"created":1,"stoppedAfterStart":[false],"phase":"review","mode":"desktop","displaySurface":"monitor","message":"Play the take or delete it. Upload is a separate step."}
{"name":"desktop start discards audio","call":"startDesktop","constraints":[{"video":true,"audio":false}],"created":0,"stoppedAfterStart":[true,true],"phase":"idle","mode":"window","displaySurface":null,"message":"The share included a microphone track. It was discarded. Start again and leave audio off."}
{"name":"desktop start discards camera facingMode","call":"startDesktop","constraints":[{"video":true,"audio":false}],"created":0,"stoppedAfterStart":[true],"phase":"idle","mode":"window","displaySurface":null,"message":"The share included a camera track. It was discarded."}
{"name":"window start discards audio","call":"start","constraints":[{"video":true,"audio":false}],"created":0,"stoppedAfterStart":[true,true],"phase":"idle","mode":"window","displaySurface":null,"message":"The share included a microphone track. It was discarded. Start again and leave audio off."}
```

## 5. Honesty of the tests against Accept

The commit has no separate coverage table. These are the tests that claim each Accept clause.

| Accept clause | Cited test | What it proves |
|---|---|---|
| Desktop requires its own click | `page.test.ts`, "starts desktop only from its own click" | Reads `page.tsx` as text. The two `onClick` strings exist, and the desktop handler is later in the file. It does not render the page, dispatch a click, or call `getDisplayMedia`. |
| Desktop requires its own click | `session.test.ts`, "does not enter desktop mode from the window start" | Casts `start` to a function that takes a string and calls `start('desktop')`. `start` declares no parameter, so the string is ignored and `arm('window')` discards the mocked monitor. This proves the window function has no mode switch. It does not prove a click. |
| Monitor kept and labeled desktop | `session.test.ts`, "keeps a monitor from the desktop start" | A fake track with `displaySurface: 'monitor'` stays alive, and the snapshot mode is `desktop` through `stop()`. The media device is a mock. |
| Monitor kept and labeled desktop | `take.test.ts`, "saves a desktop take as desktop" | `metaFromTake` returns `mode: 'desktop'` and `display_surface: 'monitor'`. Pure data. No capture. |
| Monitor kept and labeled desktop | `upload.test.ts`, "asks for a desktop grant" | A fake `fetch` sees `{ mode: 'desktop', consent: true }` and a meta body with `display_surface: 'monitor'`. No upload. |
| Monitor kept and labeled desktop | `gates.test.ts`, "grants a consented desktop take" | Real `postGrant` / `postMeta` against an in-memory port. This proves the server stores that declared meta. It does not prove the browser produced a monitor. |
| Monitor kept and labeled desktop | `page.test.ts` strings `Take mode: {snap.mode}` and `This monitor take is labeled desktop.` | The source contains those strings. It does not mount React. The review branch in `page.tsx` does print `snap.mode` whenever `phase === 'review'`. |
| Window mode discards a monitor | `tracks.test.ts`, "keeps one window and rejects a monitor" | Pure `assessTracks` result `{ ok: false, reason: 'monitor' }`. This proves the rule. |
| Window mode discards a monitor | `session.test.ts`, "stops every track and asks again" | `start()` on a mocked monitor stops the track, creates no recorder, and the message contains "whole screen". Unchanged by this commit except that new tests were appended. |
| Window mode discards a monitor | `gates.test.ts` window meta with `display_surface: 'monitor'` | Handler returns 400. Real gate, fake storage. |
| No audio or camera | `session.test.ts` window and desktop discard tests | The mock records the constraints `{ video: true, audio: false }`, and audio or `facingMode: 'user'` stops the take. This proves the argument and the filter. It does not prove a browser honors `audio: false`. |
| No audio or camera | `tracks.test.ts` | Pure rejection of an audio track, `facingMode: 'user'`, and a video count other than 1, in both modes. The code rejects any truthy `facingMode`. The cited test uses `'user'` only. |
| No audio or camera | `page.test.ts` and `upload.test.ts` source scans | `page.tsx` contains neither `getUserMedia` nor `audio: true`. Those scans do not read `session.ts`. The session test is the one that checks the real argument. |

The page-source tests guard strings. The session, take, upload, and gate tests exercise the decision and the stored label with injected tracks. None of them open the screen picker.

## 6. README

`apps/web/record/README.md` matches the code for this slice.

- A page load does not call `getDisplayMedia`. The two button names match `page.tsx`.
- Window mode saves `mode: 'window'` and discards a reported monitor.
- Desktop mode is a second click. `start()` cannot select it. A monitor is kept. A reported `window`, `browser`, or `unknown` surface is kept under `mode: 'desktop'`, and `display_surface` stores that value.
- Audio, camera, and keystroke timing are absent from the recorder, as the README says.
- The review screen prints the mode and the captured surface.
- The server paragraph matches `gates.ts`: desktop needs the same `consent: true` check, the four surface values are the allowed set, a monitor is stored only with `mode: 'desktop'`, and a monitor labeled `window` is refused.

The README does not say the whole desktop is never captured. The page does. That mismatch is the finding below, not a README error.

The unchanged middle of the README, about `DEVLENS_RECORD_ENABLED` and env loading, was not re-tested against a live server. `.env` and `.env.example` were not opened.

## 7. Not checked

These need a human in a real browser. They are not PASS.

- The operating-system screen picker for window mode and desktop mode.
- macOS Screen Recording permission, and whether the picker offers a monitor, a window, or both.
- Whether Chrome on this machine sets `displaySurface` to `monitor` for a full-screen share.
- Whether the browser ignores `audio: false` and still attaches a system-audio track. The session would then discard the take, but that behavior was not observed.
- A camera or microphone permission prompt.
- Playback of a real WebM, the pixels in that file, and an upload to Supabase Storage.
- The reviewer page label. `apps/web/replay/` was out of scope and was not read. EVAL-18 names a browser check and the contract observability row names the reviewer page.

## Findings

| Severity | File:line | Observation | Reproduction | Recommendation |
|---|---|---|---|---|
| Medium | `apps/web/record/page.tsx:19`, `apps/web/record/page.tsx:28`, `apps/web/record/page.test.ts:14` | The always-visible Captured list says "The chosen window". The Not captured list says "The whole desktop". Those lists render in every phase, including desktop review, next to "This monitor take is labeled desktop." The desktop section itself has the correct warning. The old source test requires the substring `whole desktop`, so the stale bullet is what keeps that assertion green. | Read `page.tsx`. The consent lists are outside the phase condition. A desktop monitor review still renders line 28 and lines 61–64 together. | Qualify the lists by mode. Say the whole desktop is outside the recording only in window mode. Change `page.test.ts` line 14 so it no longer requires the unqualified phrase. |
| Low | `apps/web/record/page.tsx:15` | The intro says "Nothing is recorded until you click Start recording." Neither button is labeled Start recording. The buttons say "Record one window" and "Record my desktop (second opt-in)." The next sentence names those buttons. The older page test still looks for the string "Start recording", which now matches the intro only. | Read `page.tsx` lines 15 and 42–46. | Name the two buttons in the intro, or restore a button label that matches the sentence. |

## Accept and contract lines

Code and unit evidence is separate from the real picker. A PASS here means the mocked tracks, the meta object, and the in-memory server. It does not mean a human used the screen picker.

- Desktop requires its own click: PASS for the code path. Real browser click: NOT CHECKED.
- A monitor take is kept and labeled desktop: PASS for mocked tracks, meta, and the record-page review markup. Real screen picker: NOT CHECKED. Reviewer page: NOT CHECKED.
- Window mode still discards a monitor: PASS for a declared `displaySurface: 'monitor'`. Real screen picker: NOT CHECKED.
- Neither mode records audio or camera: PASS for the constraint, the track filter, and the absence of `getUserMedia` and key handlers. Real devices and the macOS permission dialog: NOT CHECKED.
- REQ-2, declared monitor discarded in window mode, audio off: PASS in code and tests. Browser half of EVAL-2: NOT CHECKED.
- REQ-18, second opt-in, monitor allowed, record page labels desktop: PASS in code and tests. Browser half: NOT CHECKED.
- NOT-2, no camera, microphone, or keystroke timing; desktop video only in desktop mode after consent: PASS in code and tests. Real devices: NOT CHECKED.
- EVAL-2: NOT CHECKED. The contract method is `browser`, and the contract result is still `not run`.
- EVAL-18: NOT CHECKED. The contract method is `browser`, and the reviewer page was not reviewed.

## Verdict

PASS WITH FINDINGS. Do not mark Slice 9 VERIFIED. The recording rules hold under the automated checks and the in-memory probe. A human still has to run both picker paths. The consent lists on the record page should be corrected before that check, so the desktop warning and the Not captured list say the same thing.
