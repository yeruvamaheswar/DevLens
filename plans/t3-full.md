---
kind: plan
title: T3 Code adapter, from experimental to verified (CR-12)
status: active
updated: 2026-10-29
---
Summary: Make the T3 Code adapter full-featured and verified, proven on a new Rust + Supabase app that Uma builds in T3.
Goal: T3 is a second verified capture adapter by 3:30 PM CDT, or it stays experimental with the gap written down.
Intent: "We need to make T3 out of experimental and full feature. Build the full stack app and test the Devlens."
Not wanted: a score, rank, or verdict · staged failures · a looser sandbox than the Rust exception · secrets in captures, Git, or chat
Rules: freeze 3:30 PM CDT (DEC-1) · unverified work stays off main · different session reviews every slice · golden replay stays the fallback
Time now: 11:05 CDT · 4 h 25 min to freeze

## Loop
1. Approve this plan · user
2. Slices 1 and 2 in parallel · Claude (sonnet/medium, opus/high)
3. Install Rust, then real take in T3 with live capture on · user
4. Slices 3 and 4 in parallel, during the take · Claude (opus/medium, opus/high)
5. Verify the take, independent review, relabel · Claude (sonnet/medium review)

## Requirements
| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Live capture: `/recruiter` shows a T3 session's events while it runs, within 10 s of each event | user |
| REQ-2 | A new full-stack app (Rust API + Supabase + web page), built in T3 with Uma's own prompts, is captured end to end with a window recording | user |
| REQ-3 | Rust test runs (`cargo test`) are detected as tests, get a pass/fail status, and re-run in the sandbox | user (via Rust choice) |
| REQ-4 | The hosted site shows a newly imported T3 capture without a Git push | user |
| REQ-5 | The adapter can read T3 through T3's supported RPC API, not only its internal database | user |
| REQ-6 | The label changes from experimental to verified only when EVAL-1 to EVAL-12 pass | user |
| NOT-1 | The sandbox gets no network and no writes outside its temp folder. The only new access is read-only `~/.rustup` and `~/.cargo`, and only for `cargo` commands | agent |
| NOT-2 | DevLens never writes to T3's database, git refs, or calls a T3 RPC that changes state | agent |
| NOT-3 | Published captures live in private Supabase storage with RLS; only the server key reads them; no secret values in any capture | agent |
| NOT-4 | No re-prompting to stage a failure. The take's chain is whatever happened | agent |

## Decisions
| ID | Decision | By |
|---|---|---|
| DEC-1 | Feature freeze moves from noon to 3:30 PM CDT today for this work (amends contract DEC-7) | user, 10:59 |
| DEC-2 | Scope: live capture, real take + verify, supported RPC, hosted imports | user, 11:00 |
| DEC-3 | Test app: a new app built in T3, in Rust with Supabase | user, 11:02 |
| DEC-4 | Install Rust with rustup; add a read-only sandbox exception for the toolchain | user, 11:03 |
| DEC-5 | Verified bar: every eval below passes on the real take, plus a different-session review | user, 11:01 |
| DEC-6 | At 3:30 PM, any slice without passing evals stays on its branch and the label stays experimental | agent, approved by user 11:12 |
| DEC-7 | Order: slices 1+2 first (the take needs them), then 3+4 during the take, then 6 | agent, approved by user 11:12 |

## Evals
| ID | REQ | Check | Method | Result |
|---|---|---|---|---|
| EVAL-1 | REQ-1 | With `t3 watch` running, a turn item added to a temp T3 database shows in `/api/journey` within 10 s | integration | pass 2026-10-29, watch.test.ts |
| EVAL-2 | REQ-1 | After the session ends, the watch output equals a one-shot `import` of the same thread (same event ids and payloads) | integration | pass 2026-10-29, watch.test.ts (byte-identical) |
| EVAL-3 | REQ-3 | `isTestRun` accepts `cargo test`, `cargo test --offline`, `cd app && cargo test -- --nocapture`; rejects `cargo build`, `cargo run` | unit | pass 2026-10-29, t3.test.ts |
| EVAL-4 | REQ-3 | Status: `test result: ok` → passed; `test result: FAILED` → failed; `error: could not compile` → failed | unit | pass 2026-10-29, capture.test.ts |
| EVAL-5 | REQ-3, NOT-1 | Sandbox re-run of `cargo test --offline` on a tiny crate passes; the same run cannot read `~/.ssh`, reach the network, or write to `~/.cargo` | integration | pass 2026-10-29, rerun.test.ts; reviewed, bypass fixed in 6ae231a |
| EVAL-6 | REQ-4, NOT-3 | `t3 publish` uploads a capture; the anon key cannot read it; the hosted `/api/journey` lists and loads it | integration + hosted smoke | local pass 2026-10-29 (next start, publish.test.ts); hosted smoke waits on Vercel env |
| EVAL-7 | REQ-5, NOT-2 | The RPC reader yields the same events as the database reader for one thread, using read-only calls | integration | not run |
| EVAL-8 | REQ-2 | Real take: every station cites real event ids; Uma's prompts have actor `developer`; provider and model shown | unit on the capture + human | not run |
| EVAL-9 | REQ-2, REQ-3 | `t3 verify` on the take: sandbox re-run of the last passing `cargo test` passes | integration | not run |
| EVAL-10 | REQ-2 | Clicking the first failing-test station seeks the window recording to within 2 s of that event | browser | not run |
| EVAL-11 | REQ-6 | A different session reviews the slice diffs and the take: PASS or PASS WITH FIXES, all fixed | human (review) | not run |
| EVAL-12 | all | `npm run check`, all test suites, `fixture:verify`, `build`, `check:bundle` still pass; golden replay unchanged | integration | not run |

## Infrastructure
| Resource | Defined in | Applied by | Secrets |
|---|---|---|---|
| Rust toolchain (rustup, stable) | manual | Claude, with Uma's OK (DEC-4) | none |
| Rust app's Supabase table | the new app's `supabase/*.sql`, written in the T3 session | Claude via Supabase MCP after review | `SUPABASE_SECRET_KEY` (local `.env` of the app) |
| Private storage for published captures | `supabase/migrations/` in DevLens (slice 3) | Claude via Supabase MCP | `SUPABASE_SECRET_KEY` |
| Vercel `devlens` env for hosted imports | manual (dashboard) | user | `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL` |
| New app GitHub repo | unknown | unknown | none |

## Observability
| Signal | Seen in | Eval |
|---|---|---|
| Watch: each re-import (thread, event count, time) and each read error | `t3 watch` stderr | EVAL-1 |
| Publish: uploaded object names and sizes | `t3 publish` stdout | EVAL-6 |
| Hosted journey load failures | Vercel runtime logs, project `devlens` | EVAL-6 |
| Sandbox re-run result and isolation mode | `rerun.jsonl` payload | EVAL-5, EVAL-9 |

## Slices
### Slice 1: Live capture
- Covers: REQ-1
- Model: Claude (sonnet/medium)
- Depends on: none
- Files: `packages/t3/src/watch.ts` (new), `packages/t3/src/cli.ts`, `apps/web/recruiter/journey-section.tsx`, `packages/t3/tests/watch.test.ts`, `packages/t3/README.md`
- [x] `t3 watch --thread <id>` (or `--workspace <dir>` for the newest thread) polls the read-only database every 2 s and re-imports when the thread changes · Claude (sonnet/medium) · EVAL-1, EVAL-2 pass (watch.test.ts, 3 tests); live 10 s run on a real thread: 307 events, clean stop · revert 14ce723
- [x] `/recruiter` refetches a `t3:` source every 5 s while the capture says the session is running; shows "Live" · Claude (sonnet/medium) · not checked in a browser yet · revert 14ce723

### Slice 2: Rust tests and sandbox
- Covers: REQ-3, NOT-1
- Model: Claude (opus/high), because it changes the sandbox
- Depends on: Rust installed
- Files: `packages/t3/src/map.ts`, `packages/capture/map-hook.ts`, `packages/link/src/rerun.ts`, their tests, `packages/t3/README.md`
- [x] Install rustup stable · Claude · cargo 1.99.1, rustc 1.99.1; rustup added `. "$HOME/.cargo/env"` to ~/.zshenv and ~/.profile · `rustup self uninstall`
- [x] `cargo test` detection and compile-error status · Claude (opus/high) · EVAL-3, EVAL-4 pass (t3 18, capture 37 tests) · revert 14ce723
- [x] Read-only `~/.rustup`, `~/.cargo/bin`, `~/.cargo/registry/{index,cache}`, `~/.cargo/git/db` for `cargo test` re-runs only; `CARGO_TARGET_DIR` and `CARGO_HOME` writes inside the temp folder · Claude (opus/high) · EVAL-5 pass (rerun 19 tests: home, ~/.ssh, ~/.cargo writes, loopback and 1.1.1.1 denied); serde crate offline re-run 4.3 s · revert 14ce723

- [x] Independent review of slices 1-2 · Claude (sonnet/medium), separate session · PASS WITH FIXES: 2 Medium (live polling could stall; a crafted `cd . & …` step reached the Rust read exception), 5 Low. Fixed in 6ae231a with regression tests: strict `cd` steps in both detectors, crates.io-only registry reads, steady 5 s polling for `t3:` sources, change marker includes the thread's event stream and statuses, guarded compile rule. Serde crate re-run after the fix: passed, 2.3 s · revert 6ae231a
- [x] Review findings 5-6 (atomic writes in `runImport`, `--interval` validation) · Claude · fixed in 0d56665; writes renamed into place and keep the watch stamp; `--interval` below 250 ms or non-numeric is refused (watch.test.ts) · revert 0d56665

### Slice 3: Hosted imports
- Covers: REQ-4, NOT-3
- Model: Claude (opus/medium)
- Depends on: none (parallel with slice 4); needs Uma to set Vercel env
- Files: `packages/t3/src/publish.ts` (new), `packages/t3/src/cli.ts`, `apps/web/journey/sources.ts`, `supabase/migrations/<new>.sql`, tests
- [x] Private bucket `t3-captures`, RLS on, no public policies · Claude (opus/medium) · migration 20261029120000 applied; anon key: download, list, signed URL, upload all refused; advisor adds nothing · drop the bucket
- [x] `t3 publish --thread <id>` uploads events, edges, capture, and the recording only with `--with-recording` · Claude (opus/medium) · publish.test.ts 8 tests; rehearsal 2 published as `rehearsal-2-sprintboard` · delete objects
- [x] `/api/journey` lists published captures server-side (`t3-pub:<id>`) · Claude (opus/medium) · `next start` on 3200: listed and loaded (9 events, 16 edges); traversal keys 404; recording via 10-minute signed URL; build and check:bundle pass. Review running · revert 15955a0
- [ ] Add `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_URL` to Vercel project `devlens` · user · hosted smoke · remove the vars

### Slice 4: Supported RPC reader
- Covers: REQ-5, NOT-2
- Model: Claude (opus/high), time-boxed to 2:30 PM
- Depends on: none (parallel with slice 3)
- Files: `packages/t3/src/rpc.ts` (new), `packages/t3/src/cli.ts`, `packages/t3/tests/rpc.test.ts`, `packages/t3/README.md`
- [ ] Find T3's RPC transport, auth, and read-only thread subscription in the installed T3 server · Claude (opus/high) · written finding in this page · none
- [ ] `--via rpc` reader feeding the same mapper · Claude (opus/high) · EVAL-7 · revert
- [ ] If pairing needs a token, Uma enters it in a private card · user · EVAL-7 · revoke the token in T3

### Slice 5: Real take (Uma)
- Covers: REQ-2
- Model: user (T3 provider and model of Uma's choice)
- Depends on: slices 1 and 2
- Files: the new Rust app repo only
- [ ] Start `npm run t3 -- watch --workspace <new app dir>` and open `/recruiter?source=t3:<id>` · user · stations appear live · none
- [ ] `/record` → Record one window → T3; build the Rust + Supabase app with your own prompts, including tests · user · EVAL-8 · delete the take
- [ ] Stop, review, upload the take · user · EVAL-10 · delete the take

### Slice 6: Verify and relabel
- Covers: REQ-6
- Model: Claude (sonnet/medium) for review, a fresh session
- Depends on: slice 5, and slices 3 and 4 if done
- Files: `CLAUDE.md`, `plans/devlens.contract.md`, `README.md`, `packages/t3/README.md`, `apps/web/journey/sources.ts`, `plans/t3-full.md`
- [ ] Import, fetch the recording, `t3 verify` · Claude · EVAL-8, EVAL-9, EVAL-10 · none
- [ ] Different-session review of slices 1-4 and the take · Claude (sonnet/medium) · EVAL-11 · fix or keep experimental
- [ ] Full regression · Claude · EVAL-12 · revert
- [ ] If EVAL-1 to EVAL-12 pass: CR-12 marks T3 verified in CLAUDE.md, the contract (EVAL-14), README, `packages/t3/README.md`, and the UI badge · Claude · user approves CR-12 · revert the relabel commit

### Open
- App idea for the Rust take (bookmarks, habits, expenses?): unknown, Uma's choice
- T3 RPC needs device pairing or a token: unknown until slice 4's first step
- New app's GitHub repo and Vercel deploy: unknown, not in scope unless asked

## Changes
| ID | Date | Change | Affects | Approved |
|---|---|---|---|---|
| CR-12 | 2026-10-29 | T3 adapter: live capture, Rust test support with a read-only toolchain sandbox exception, hosted imports via private Supabase storage, RPC reader; promote to verified only if EVAL-1 to EVAL-12 pass. Freeze moves to 3:30 PM | contract DEC-7, EVAL-14, CR-11, NOT-3 | user, 11:12 |
