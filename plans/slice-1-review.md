# Slice 1 review (independent)

Reviewer: Claude sonnet, fresh session. Date: 2026-10-26. No source file was edited. Node v24.3.0.
`SUPABASE_SECRET_KEY` in `.env` is empty. The Supabase project has 0 events, 0 edges and 0 Storage objects (checked by read-only SQL on `hivfaqlabtbrhrviwrrm`).

**Verdict: NOT VERIFIED.** Three of the four Verify commands fail, the build fails, and the Replay API returns HTTP 500.

## Checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | `npm run check` | FAIL | `packages/core/ingest.ts(10,48): error TS2345` — the `Event[] \| Edge[] \| …` union is not assignable to the `upsert` argument. |
| 1b | `npm run test:tracer` | PASS | 1 file, 4 tests passed. |
| 1c | `npm run demo:smoke` | FAIL | esbuild: `Top-level await is currently not supported with the "cjs" output format` (smoke.ts lines 8, 11, 17, 21, 25). |
| 1d | `npm run demo:smoke -- --offline` | FAIL | Same error. |
| 2 | broken-api starter | PASS | `npm test` fails with `wrong base URL: expected /api, received /v0`. The README states the bug in one line. |
| 3a | Deterministic `verifies` edge | PASS (code and unit test) | `tracer.ts` sets `derived_by: 'rule-5-later-pass-v1'` and `evidence_event_ids: [failure, patch, pass]`, which are real fixture IDs. The unit tests pass. |
| 3b | No model call | PASS | grep for `anthropic` and `openai` finds nothing. |
| 3c | Fixture labeling | PASS | Every JSONL payload says `tracer fixture, hand-authored`. The WebM title tag says `generated placeholder, not a live take`. The fixtures README and the page warning say so. |
| 4 | Types vs plan and docs | PASS with gaps | Field names and allowed values match `docs/implementation.md`. See F6 and F7. |
| 5a | Publishable SELECT of the fixture | BLOCKED_ON_KEY | The query succeeds (no error) but returns 0 rows because nothing is ingested. Reading data is unproven. |
| 5b | Publishable INSERT into events | PASS | `42501 permission denied for table events`. |
| 5c | SELECT of another session | PASS (vacuous) | 0 rows. Not meaningful until the fixture is ingested. The policy is `session_id='tracer-fixture-1'`. |
| 5d | Storage direct read | PASS | Bucket `recordings` has `public=false` and no `storage.objects` policy. Publishable download gives "Object not found". The public URL returns 400. Upload gives an RLS violation. The direct-read denial against a real object is BLOCKED_ON_KEY. |
| 5e | RLS enabled | PASS | `relrowsecurity` is true on events, entities and edges. Only three SELECT policies exist. |
| 5f | Signed URL, upload, `ingest:fixture` | BLOCKED_ON_KEY | Also unrunnable because of F2. |
| 5g | `npm run build && npm run check:bundle` | FAIL | Turbopack: "Next.js can't recognize the exported `runtime` field in route. It mustn't be reexported." The bundle check then hits the same top-level-await error. The bundle claim is unproven. |
| 5h | Secret value in repo | PASS | The grep for `sb_secret_` and JWT patterns finds nothing. `.env` is git-ignored and untracked. `NEXT_PUBLIC_` variables hold only the URL and the publishable key. |
| 6a | Replay page, offline | FAIL | `npm run demo -- --offline` serves `/replay` with 200. `GET /api/replay?offline=1` and `GET /api/replay/media` return 500 (the F3 error), so the page shows "Replay unavailable". |
| 6b | Click seeks video | NOT_RUN | The page cannot load data. Static reading: the click sets `currentTime = media_offset_ms/1000`, and the cited events show their IDs. |
| 6c | Verdict words | PASS | grep for `score`, `rank` and `hire` finds nothing in apps, packages or examples. |
| 6d | WebM | PASS | VP9, 640x360, 6.0 s, 43,704 bytes. The full ffmpeg decode succeeds. The header starts with `1a45dfa3`. |
| 7 | Diff scope | PASS with notes | No secret is committed. Extra files outside the Files list: `apps/web/AGENTS.md`, `apps/web/app/**`, `apps/web/tsconfig.json`, `apps/web/next-env.d.ts` and `tsconfig.json`. The README declares the Next bootstrap files. `AGENTS.md` is not declared. |

## Findings

| ID | File | Consequence | Suggested fix | Severity |
|---|---|---|---|---|
| F1 | `packages/core/ingest.ts:10` | `npm run check` fails. The Verify gate cannot pass. | Type the loop rows (for example a per-table typed call) or cast with a stated reason. | High |
| F2 | `package.json`; `packages/core/smoke.ts`, `ingest.ts`, `bundle-check.ts` | The scripts use top-level await. Without `"type":"module"`, tsx compiles to CJS and fails. `demo:smoke`, `demo:smoke --offline`, `ingest:fixture` and `check:bundle` all fail. | Add `"type":"module"` to the root `package.json`, or wrap the scripts in an async `main()`. Re-test Next and vitest afterwards. | High |
| F3 | `apps/web/app/api/replay/route.ts`, `.../media/route.ts` | Next rejects a re-exported `runtime`. The build fails and the dev API returns 500, so Replay never loads in any mode. | Remove `runtime` from the wrappers and declare `export const runtime = 'nodejs'` in the wrapper file (or drop it, since nodejs is the default). | High |
| F4 | `plans/devlens-implementation.md` (Slice 1) | The plan requires the tracer to read Supabase, but nothing is ingested. The live path (5a, 5f, signed media) is unproven. | Fill `SUPABASE_SECRET_KEY`, run `npm run ingest:fixture`, then repeat 5a, 5c, 5d and the smoke command. | Medium (blocked) |
| F5 | `packages/core/smoke.ts:13` | Online smoke runs the live checks only when `SUPABASE_SECRET_KEY` is set. Otherwise it prints PASS with "NOT CHECKED". A weak PASS line can be read as success. | Print `PASS` only when live checks ran. Otherwise exit non-zero or print `PARTIAL`. | Low |
| F6 | `examples/broken-api/fixtures/session.jsonl` | Events carry `source: claude_code_hook` and `actor: tool`, but they are hand-authored. `provenance: inferred` is the only machine-readable hint besides the payload label. A consumer could treat them as real hook events. | Add a top-level marker or use a distinct `source`. At least keep the payload label in the DB row. | Low |
| F7 | `supabase/migrations/…sql` vs `packages/core/event.ts` | `edges.rel` has no CHECK constraint, while the TS type limits it to 8 values. `entities.kind` allows `competency`, which touches NOT-1. | Add a `rel` CHECK. Drop `competency` from the kind list. | Low |
| F8 | `apps/web/AGENTS.md` | An undeclared file generated by Next. It is outside the Slice 1 Files list. | Delete it or declare it in the README. | Low |
| F9 | `README` / plan | REQ-11 text says `npm run demo --offline`. The implementation uses `npm run demo -- --offline`. This is the correct npm syntax. | Note the exact command in the docs. | Info |

## Not run
- Live Supabase read, signed URL, upload and ingest (key empty).
- Browser click and seek, the "local fixture" label in the browser, and the evidence panel (the API returns 500).
- Client bundle scan (the build fails).

## One-line verdict
NOT VERIFIED — type check, both smoke commands, build and bundle check fail, and Replay's API returns 500. RLS insert denial and the private bucket are correct, and the tracer unit tests pass.
