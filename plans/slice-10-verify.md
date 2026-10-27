---
kind: review
title: Slice 10 independent verification (fresh clone, README audit, f5741ad review)
status: pass-with-findings
updated: 2026-10-27
---
Reviewer: a new session. It did not build the code. Repo HEAD was `3ee6d42`. Nothing was committed, pushed, or installed. No `.env` content and no Supabase project was touched.

## Verdict

**PASS WITH FINDINGS.** Every command passed in a fresh clone. The API and media checks passed. The two seek buttons landed at 30.446 and 177.918 seconds in a production build. No high finding. One medium finding: the dev server (`npm run demo`) reloaded in a loop under the preview browser. The README has several small inaccuracies.

A real `npm install` was NOT tested. `node_modules` was copied from the main repo into the clone. A cold install, and the lockfile behavior, are unverified.

## Part A: fresh clone

The clone came from `git clone` of the local repo. It had no `.env`. `.env.example` is tracked and was not read.

| Command | Exit | Key output |
|---|---|---|
| `npm run check` | 0 | `tsc --noEmit`, no errors |
| `npm run test:replay` | 0 | 3 files, 7 tests passed |
| `npm run test:link` | 0 | 1 file, 13 tests passed |
| `npm run test:record` | 0 | 6 files, 33 tests passed |
| `npm run demo:smoke -- --offline` | 0 | PASS replay fixture, PASS WebM header, 3 x SKIPPED(offline requested) |
| `npm run fixture:verify -- broken-api` | 0 | `PASS` |
| `npm run scenario:verify -- --all-starters` | 0 | 7 of 7 `PASS` |

Server checks. Port 3000 was already used by an older process, not mine. I left it running. Next chose 3001 for `npm run demo -- --offline`.

| Check | Result |
|---|---|
| `GET /` | 200. Links to `/record` and `/replay` |
| `GET /replay`, `GET /record` | 200, 200 |
| `GET /api/replay?offline=1` | JSON with `claim`, 3 `questions`, 7 `unknowns`, 5 `not_captured`, `media.url=/api/replay/media`. `mode` is `local fixture` |
| `/api/replay/media`, `Range: bytes=0-99` | 206, `Content-Range: bytes 0-99/16047324`, 100 bytes, `video/webm` |
| No offline flag, no env (second server, `env -i`, port 3002) | `mode` is `local fixture`. `warning` starts `Supabase unavailable; using local golden files.` |

Browser check, production build (`next build` then `next start`, port 3003). The page showed `golden take, broken-api, 2026-10-27 · local fixture`. A script clicked both buttons.

| Button | video.currentTime |
|---|---|
| "Open the first failed test at 30.4 seconds" | 30.446 |
| "Seek to the passing test at 177.9 seconds" | 177.918 |

Duration was 276.75 s and `video.error` was null. These were scripted `.click()` calls, not pointer clicks. The server, preview tab, and temp dir were removed.

## Findings

| ID | Sev | Where | Finding |
|---|---|---|---|
| F1 | Medium (cause not isolated) | `package.json:6` (`demo`), `packages/core/demo.ts:4` | In `next dev` the preview tab reloaded in a loop. The log showed repeated `Compiled in 1-22ms` and `GET /replay`. The page never held a stable `<video>`, so no button could be clicked. The production build was stable. I did not find the cause. Possible causes: the preview tool, `/tmp` file watching, or the `AGENTS.md` that Next writes. If the demo runs in `next dev` in a real browser, test it there first |
| F2 | Low | README:62 | The `link.ts` command shows `--recording` and `--rerun` as required. `packages/cli/src/link.ts:36` makes them optional. The dry run worked: `events: 31`, `edges: 32` |
| F3 | Low | README:107-119 | `packages/cli/src/rerun.ts:38` has `--unsafe-no-isolation`. It turns off the sandbox. The README does not name it. `packages/link/src/rerun.ts:228` refuses to run without `sandbox-exec` unless it is set. Add one sentence |
| F4 | Low | README:22 | "Requires Node 22 or later". No `engines` field and no `.nvmrc`. I tested only Node 24.3.0 |
| F5 | Low | README:29 | The quick start says open `localhost:3000`. If 3000 is busy, Next moves to 3001. This happened here |
| F6 | Low | `apps/web/replay/page.tsx` (rules paragraph added in f5741ad) | "Observed means the rule read recorded events directly." In `packages/link/src/rules.ts:175,206` `failed` and `verifies` are `observed` only when a sandbox re-run confirms them. "Inferred means the rule guessed" is loose wording |
| F7 | Low | `apps/web/questions.ts:57` | Question 1 now reads "Did the next prompt mention the error?". The rule fires only when it did not. The text hides a known answer. The cited events show the answer |
| F8 | Info | README:42 | `DEVLENS_RECORD_ENABLED` must be exactly `1`. `apps/web/api/recordings/gates.ts:6` confirms it. The README says so |

## Part B: README audit

Checked and correct:
- Script names in the Commands table all exist in `package.json`. The flags `--offline` and `--all-starters` work.
- Env names all appear in code. `DEVLENS_OFFLINE` is set by `demo.ts:4`. The recording flag gates `/api/recordings` and `/api/recordings/[id]/meta`.
- Routes `/replay`, `/record`, `/api/replay`, `/api/recordings` exist. The `?offline=1` flag works on the page and the API.
- `fixture:verify` claims match `fixture-verify.ts`: same-command fail then pass, events in window, consent, one video track, no audio.
- The 30-minute link is `SIGNED_URL_SECONDS = 1800`. The `recordings` bucket is private in the migrations. The host check on `hivfaqlabtbrhrviwrrm` is in `server.ts:57` and `link.ts`.
- Edge names match `rules.ts`: `prompted`, `edited`, `ran_test`, `failed`, `supersedes`, `verifies`.
- Linked files all exist: golden README, `RECORDING.md`, `apps/web/record/README.md`, contract, plan, `docs/competitors.md`, `plans/slice-5-verify3.md`.
- Golden limits match `golden/README.md`, `git-log.txt` (name and email), and `meta.json` (window, 0 audio, 1 video, consent).
- The deadline "Thursday 29 October 2026, 5:00 PM Central" matches `plans/devlens.contract.md:8`.
- "Audio and camera are always off. The server refuses..." The server checks audio and one video track (`gates.ts:78`). The camera check is in the browser (`tracks.ts:26`). The README sentence does not claim a server camera check, so it holds.

**Does-not-claim list vs `plans/slice-5-verify3.md`.** All seven items match the report's "must not claim" paragraph and findings V1, V2, V4, V5. The report's V3 (extra env names `PWD`, `SHLVL`) has no README line. The README makes no claim that the env is exact, so there is no conflict. The positive sentence at README:119 matches the report's allowed statement.

**Hostile code, score, or verdict.** No sentence implies containment of hostile code. The README says the opposite at README:109-111. Words like score, rank, and hire appear only in negations (README:5, 138). No sentence implies a score or verdict.

**Scenario table vs tests and `scenario.json`.** All seven rows match. Each `scenario.json` `failure` string equals the `assert.fail` text in its test, and `scenario:verify` passed on all seven. Wording check:

| Directory | Test text | README text |
|---|---|---|
| broken-api | `wrong base URL: expected /api, received /v0`, then `expected Authorization header` | matches |
| swapped-field | `expected name "Ada", received email` | matches |
| missing-auth | `request sends no Authorization header` | matches |
| stale-cache | `cache returns old value after an update` | matches |
| wrong-page | `pagination asks for the wrong page number` | README drops "number". Fine |
| bad-date | `date parsing gives the wrong day` | matches |
| empty-list | `empty result crashes instead of returning an empty list` | matches |

Unverifiable or overstated: "has not been checked by a person in a real browser" (README:90) is a self-statement. I cannot confirm it. See also F2 to F5.

## Part C: commit f5741ad

Six files changed. All are named in the commit message and all match its claims. No other file changed.

| Change | Result |
|---|---|
| Questions reworded (`questions.ts`, 2 tests) | Done. `view.test.ts` still expects `first-fix and final-fix`. See F7 |
| `aria-label` on `<video>` | Done: "Recording of the Claude Code terminal" |
| Inferred-pairing caption | Done. It appears on every diff, which is correct: pairing is always by session order |
| Rule provenance sentence | Added. Wording is loose, see F6 |
| `?offline` is `=== '1'` | Done in `page.tsx`. The API route already used `=== '1'`. A test pins it |
| Media route try/catch | Done. It wraps only `readFile` and returns 404 `Recording unavailable.`. Range code is unchanged. A 206 for bytes 0-99 still works |

Forbidden words: none of score, rank, hire, verdict, cheat, competen, recommend, suspicious, trust appear in the added user-visible text. The page test still blocks `score|rank|hire`. The added "Claude Code collapses tool output" paragraph matches README limit 2.

## Not checked

- `npm install` from a cold cache, and the lockfile.
- Supabase mode: label `supabase`, signed media URL, the live smoke checks, `npm run build && npm run check:bundle` (the build ran, the bundle check did not).
- `npm run test:rerun`, `test:sync`, `test:capture`. They exist in `package.json`. I did not run them.
- Real pointer clicks, Safari or Firefox, and `next dev` in a normal browser (F1).
- `/record` in a browser: window and desktop pickers, upload, and the `DEVLENS_RECORD_ENABLED` gate behavior over HTTP.
- `init` hook install, the capture hooks on a live Claude Code session, and `sandbox-exec` behavior.
- Node 22 and non-macOS behavior.

## Tech Lead follow-up (not part of the independent review)

- F1: I re-ran `npm run demo -- --offline` from a fresh clone on port 3100 with the preview browser. The page stayed loaded for 12 seconds with no reload. Both buttons seeked: 30.446 s and 177.918 s. The dev log showed no repeated compiles. A leftover `next dev` (pid 1887, started 10:56) held port 3000 on the main repo, and my `npm run build` rewrote the same `.next` folder. That is the likely cause, but I did not prove it. Status: not reproduced on a clean dev server.
- F2, F3, F4, F5, F6, F7 are fixed in the README, `page.tsx` and `questions.ts`. `npm run check` and `npm run test:replay` pass after the change. A different session did not re-read these small edits.
- Still unverified: a cold `npm install`.
