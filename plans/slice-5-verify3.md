---
kind: review
title: Slice 5 independent verification 3
status: gaps
updated: 2026-10-26
---
Summary: Sandbox execution and the live replace_session path now run. One role check is still not run, and the documented sandbox limits were observed.
Goal: Finish the NOT_RUN containment and live RPC checks without fixing code or changing the fixture.
Rules: Only this new repository file edited · No install, commit, push, or deploy · Project hivfaqlabtbrhrviwrrm only · No writes to tracer-fixture-1

## Verdict

**VERIFIED-WITH-GAPS.** The sandbox gate works in this session. `npm run test:rerun` passed 14/14. A plain command under the generated profile returned `status: passed`. The containment attacks against the author's own task code were blocked, except the documented setsid escape, `/etc` read, metadata, and ancestor directory names. Live session `verify-tmp-slice5b` passed write, idempotence, pre-write conflict rejection, FK rollback, publishable-key read denial, and anon execute denial. Cleanup restored 5 events / 1 edge / 1 entity and the prior fixture hash. Authenticated execute was not called.

## Method

- New session. This reviewer did not write the implementation and did not edit product code.
- Read `CLAUDE.md` and `plans/slice-5-rereview.md` first. Previously PASS rules, dedupe, and write-path items were not re-run.
- Gate: `sandbox-exec -p '(version 1)(allow default)' /bin/echo ok` printed `ok` and exited 0. It did not print `sandbox_apply: Operation not permitted`.
- Probes lived in `/tmp/devlens-s5-verify3/`. Canaries and planted keys were fake. Real `.env` was loaded only inside the CLI and the service-role client. Output was scanned and no real secret value was present. This report prints no key values.
- Every service-role client checked host `hivfaqlabtbrhrviwrrm.supabase.co` before use. The only live session id written was `verify-tmp-slice5b`.
- HTML generation omitted because the assignment allows only this new Markdown file.

## Required checks

| Check | Result | Exact safe output / observation |
|---|---|---|
| Sandbox gate | PASS | `ok`, exit 0 |
| `npm run test:rerun` | PASS | `Test Files  1 passed (1)`; `Tests  14 passed (14)`; duration 2.61s; exit 0. No skipped count. The suite includes the plain-command, key, timeout, and background-child cases |
| Positive control `echo ok` | PASS | `status:"passed"`, `isolation:"sandbox-exec"`, `bytes:3`, output `ok`, `tempRemaining:0` |
| Absolute canary read | PASS blocked | `blocked:EPERM`; fake canary absent |
| Relative `..` canary read | PASS blocked | `Operation not permitted`; probe printed `blocked`; fake canary absent |
| Runtime symlink to repo `.env` | PASS blocked | `blocked:EPERM`; symlink not left in the original target |
| `/dev/fd` read | PASS blocked | Outer open failed: `Operation not permitted`; status `failed`; fake canary absent. `cat` never read the file |
| `cat < file` | PASS blocked | `Operation not permitted`; probe printed `blocked` |
| python3 read | PASS blocked | python3 present; output `blocked` |
| perl read | PASS blocked | perl present; output `blocked` |
| Repo `.env` content | PASS blocked | `blocked:EPERM`; real secret scan false |
| `~/.claude`, `~/.ssh`, `~/.zshrc` content | PASS blocked | each `blocked:EPERM` |
| Repo `.env` metadata | LIMIT | `metadata-visible` (`stat` succeeded). Content read stayed blocked |
| Repo directory names | PASS blocked | `blocked:EPERM` |
| Ancestor temp names | LIMIT | from the copy, `../..` was `readable count=81594`. Names were not printed. Sibling canary content stayed `EPERM` |
| `/etc/hosts` content | LIMIT | `readable`. Contents were not printed |
| Localhost network | PASS blocked | Outside control `nc` reached the listener (`controlHits:1`). Sandboxed curl exit 7, nc exit 1, node `error:EPERM`. Listener hits stayed 0 for all three |
| Internet `1.1.1.1:80` | PASS blocked | curl exit 7, nc exit 1, node `error:EPERM`. No `connected` |
| Write home, repo, `/tmp` | PASS blocked | each child `blocked:EPERM`; parent saw the file absent before and after |
| Timeout kill | PASS | status `failed`, elapsed 2516ms for a 2500ms limit, child pid printed, `ps` after return `absent` |
| Ordinary unref child | PASS | pid printed, `ps` after return `absent` |
| `detached:true` / setsid child | FAIL as an escape; matches the builder note | After return, `ps` showed pid 87768, pgid 87768, stat `Ss`, command `node -e setInterval...`. Reviewer sent SIGKILL. Next `ps` was `absent`. End sweep found no such process |
| Output cap, 50,000 bytes | PASS | `maxOutputBytes:100`, stored `bytes:100`, status `passed`, body is `z` |
| Env allowlist and `.env` files | PASS for secrets; see V3 | Planted `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` absent. `interesting:[]`. Copied `.env` was `blocked:ENOENT`. Original target and parent `.env` were `blocked:EPERM`. `homeHasPrefix:true`, `tmpEqualsHome:true` |
| Pure `sandboxEnv` | PASS | keys `HOME,LANG,LC_ALL,NODE_ENV,PATH,TMPDIR,npm_config_cache,npm_config_update_notifier`; fake values absent; home and tmpdir `/fake/temp/home` |
| Crash cleanup | PASS | `process.abort()` status `failed`; `tempRemaining:0` |
| Mid-copy cleanup | PASS | unreadable directory caused `EACCES` on `scandir` before the command; status `threw`; `tempRemaining:0` |
| Final temp dirs and children | PASS | `tempRemaining:0` after the suite; no probe dirs and no `setInterval` children left |

## Live RPC on `verify-tmp-slice5b`

Host check printed `hivfaqlabtbrhrviwrrm.supabase.co`. Baseline and final hash: `3ecba0b8b36e5c8027cdc80590bf868f85569bb4f568fec47e02971f3994551f`. That is the same hash recorded in `plans/slice-5-rereview.md`.

| Check | Result | Exact safe output / observation |
|---|---|---|
| Empty session id detects the function | PASS | `DETECT code=P0001 message=session id required data=null`. Not `PGRST202`. Snapshot hash unchanged |
| (a) CLI write | PASS | `npx --no-install tsx packages/cli/src/link.ts` exit 0. `events=3 edges=1 seq=[1,2,3]` ids `verify-tmp-slice5b:f/a/p`. One edge, rel `verifies`. Dry-run first: `events: 3`, `edges: 1`, `dry-run unchanged=true` |
| (b) Second identical write | PASS | exit 0; session hash and full-project hash identical |
| (c) Conflicting duplicate | PASS | While the 3 rows existed: exit 1, `fullIntact=true`. A later conflict-only run printed `Event id "verify-tmp-slice5b:a" appears twice with different content`, exit 1, counts stayed 5/1/1, hash unchanged. Rejection is client-side, before RPC |
| (d) Mid-RPC FK failure | PASS | `code=23503 message=insert or update on table "edges" violates foreign key constraint "edges_dst_fkey" data=null fullIntact=true`. Bad dst was `verify-tmp-slice5b:missing` |
| (e) Publishable key read | PASS | temp events 0, temp edges 0, errors `none`. Same key saw fixture event count 5, so the empty temp read is RLS rather than a dead key |
| (f) anon execute | PASS | publishable key, `code=42501 message=permission denied for function replace_session data=null intact=true` |
| (f) authenticated execute | NOT_RUN | `signInAnonymously` returned `anonymous_provider_disabled`. No JWT secret is in `.env`. No user was created. Static `REVOKE` from `authenticated` is not a live proof |
| (g) Cleanup | PASS | `CLEANUP PASS` counts `{"events":5,"edges":1,"entities":1}` sessions `["tracer-fixture-1"]` hash equal to baseline. `fixture rows unchanged=true` |

## Findings

| ID | Severity | File | Consequence | Fix; not implemented |
|---|---|---|---|---|
| V1 | Medium for this demo; High if the demo says every child dies | `packages/link/src/rerun.ts:23`, spawn at line 171 | A `detached:true` grandchild becomes its own session and outlived `rerunTest`. Ordinary unref and timeout children were gone | Keep daemonizing commands out of the demo. Say setsid can survive. Do not claim a universal process-group kill |
| V2 | Medium claim limit | `packages/link/src/rerun.ts:125–150` | `/etc/hosts` content is readable. `stat` of the repo `.env` succeeds. The temp-directory ancestor is listable (81594 names in this run). Repo listing and the tested file contents were denied | Say the read policy is selective. Do not claim a clean-room filesystem or hidden temp names |
| V3 | Low | `packages/link/src/rerun.ts:59–77` | The child also had `PWD`, `SHLVL`, `_`, and `__CF_USER_TEXT_ENCODING`. Planted secret names were absent | Do not claim `process.env` equals `sandboxEnv` exactly. Secret stripping still held for the planted keys |
| V4 | Low verification gap | `supabase/migrations/20261026240000_replace_session_rpc.sql:36–37` | Anon execute is denied live. Authenticated execute was not called | Before claiming both roles, call the function with a real authenticated JWT. This review did not create a user |
| V5 | Low for one session | `packages/cli/src/link.ts:134–155` | Each session is one transaction. A later session can still fail after an earlier session commits. Not retested live; prior unit evidence stands | Demo one session. Do not claim all-session rollback |

No new high defect turned up. The prior launcher failure and the missing-function result are closed by the runs above.

## Demo limits

These limits are acceptable for a hackathon demo that re-runs only the author's own reviewed task code, one session at a time, and states the limits:

| Limit | Judgment |
|---|---|
| setsid / `detached:true` escape | Acceptable only if tasks do not daemonize. This run saw the child survive. It defeats "every descendant is dead before return" |
| File names and metadata | Acceptable with disclosure. Temp ancestor names and `stat` are visible. Tested secret file contents were not |
| `/etc` readable | Acceptable for that narrow demo. The policy is not a closed filesystem |
| Extra shell env names | Acceptable. They were not the planted secrets |
| Per-session, not all-session, atomicity | Acceptable for one session. The live single-session FK rollback held |

The demo must **not** claim hostile-code containment, a macOS sandbox escape defense, hidden temp or `/etc` data, universal descendant cleanup, cross-platform isolation, all-session atomicity, or a live authenticated-role execute test. It may say a normal command ran in the sandbox, returned passed, and did not read the tested secrets or reach the tested listener.

## Repository boundary

- This reviewer created only `plans/slice-5-verify3.md` in the repository.
- No product fix, install, commit, push, deploy, or fixture write.
- The detached probe child was killed. Final counts are 5 events, 1 edge, and 1 entity. Fixture hash matches the baseline.
