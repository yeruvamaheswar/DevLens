---
kind: review
title: Slice 5 independent review
status: failed
updated: 2026-10-26
---
Summary: Repository checks pass, but independent probes show data loss, false links, and incomplete sandbox containment.
Goal: Verify the deterministic linker, observed re-run, ingest, and fixture compatibility without changing implementation.
Rules: Reviewer did not build this slice · Only this review file edited in the repository · No install, commit, push, deploy, or fixture write · Authorized project only

## Verdict

**NOT VERIFIED.** Blocking gaps: duplicate ingest loses existing session data; replacement is not atomic; commands escape the temp copy; background children survive; rule 5 links without edits; mixed-session and duplicate inputs create false edges.

## Verification

- Reviewer: independent Codex session; builder identified by the assignment as Grok.
- Read `CLAUDE.md` first, then Slice 5 plan, architecture decisions and C6, Slice 3 F6, implementation rules, hook report, event contract, fixture tracer, builder code and tests.
- Independent scripts: `/tmp/devlens-s5-review/{rules.mts,sandbox.mts,extra.mts,live.mjs}`. Throwaway inputs live outside the repository. No repository tests edited.
- Real `.env` read only by Node and the CLI. No real credential values printed or copied into this report. Evidence below contains counts, booleans, fake canary results, and safe CLI messages only.
- HTML output intentionally omitted: the user explicitly authorized only `plans/slice-5-review.md`.

| Check | Result | Exact safe output / evidence |
|---|---|---|
| `npm run check` | PASS | `> tsc --noEmit`; exit `0` |
| `npm run test:link` | PASS | `Test Files  1 passed (1)`; `Tests  5 passed (5)` |
| `npm run test:rerun` | PASS | `Test Files  1 passed (1)`; `Tests  5 passed (5)` |
| `npm run test:tracer` | PASS | `Test Files  1 passed (1)`; `Tests  4 passed (4)` |
| Failed → edit → passed, no test files or patch ID | PASS | `verifies p→a`, `inferred`, evidence `[f,a,p]` |
| Failed → edit → failed → edit → passed | PASS | `verifies p→b`, evidence `[f,a,f2,b,p]`; `supersedes b→a`, evidence `[f,a,b,p]` |
| Unknown status never a pass | PASS | `PASS unknown is not pass: []` |
| Different command never verifies | PASS | `PASS different command: []` |
| No edit between failure and pass | FAIL | `verifies p→f`, evidence `[f,p]`; must produce no verifies edge |
| Interleaved prompts | PASS | Last prompt owns its subsequent tool events; rule 5 still finds the edit across prompt boundaries |
| Two sessions in `linkEvents` | FAIL | Failure `f` from session `s` cited by `verifies p→a` in session `other`; prompt edges also cross sessions |
| Unsorted input | PASS | `PASS unsorted input`; output equals chronological input output |
| Unknown/unattributed edit | PASS | `PASS unattributed edit stays unknown/unattributed`; input object unchanged; no developer label introduced |
| Duplicate ID in `linkEvents` | FAIL | `rule-5-later-pass-v1:a:a`, `src:a`, `dst:a`, `rel:supersedes`, evidence `[f,a,p]` |
| Deterministic sorted edges | PASS | `PASS byte identical sorted edges`; repeated JSON serialization identical and edge IDs sorted |
| Rule IDs and evidence identity | PASS | `PASS rule ids and real evidence`; every cited ID exists in input |
| No model call | PASS | Rules import only a type; rerun imports Node APIs and a type; CLI imports existing Supabase SDK; no model client or call |
| Ingest ID dedupe / F6 | FAIL | `ingest duplicates: [{"id":"f","seq":1},{"id":"a","seq":2},{"id":"a","seq":3},{"id":"p","seq":4}]` |
| Wrong host guard | PASS | `PASS unauthorized host rejected` for another Supabase host and authorized-host-plus-evil-suffix; source calls guard before `createClient` |
| Dry-run | PASS | Live probe: `CLI dry-run exit=0 events: 4 | edges: 2`; `after dry-run events=0 edges=0 seq=[] unique=0`; returns before env/client creation |
| Env allowlist | PASS | `fakeLeak:false`; allowed keys `HOME,LANG,LC_ALL,NODE_ENV,PATH,TMPDIR,npm_config_cache,npm_config_update_notifier`; planted SUPABASE, ANTHROPIC, NEXT_PUBLIC, and other secret absent |
| HOME and TMPDIR | PASS | `HOME TMPDIR under temp and equal=true` |
| `.env` and symlink entries excluded | PASS | `targetEnv:false,parentEnv:false,outside:false` for `env; cat .env ../.env link 2>/dev/null`; source excludes `.env.*` too |
| Output cap | PASS | `output-cap`: `status:passed,bytes:100` after writing 50,000 bytes |
| Crash / copy failure / append failure cleanup | PASS | `crash status:failed`; copy and append errors `THREW (masked)`; each `tempRemaining=0` |
| Timeout kills ordinary process group | PASS | `timeout-group status:failed`; `timeout child alive=false`; `tempRemaining=0` |
| Parent exits before timeout; child survives | FAIL | `parent-exits-child-lives status:passed`; `tempRemaining=0`; `FAIL parent-exit child survives=true` after waiting beyond timeout; reviewer killed the planted child |
| Absolute command path escape | FAIL | `absolute-command-escape status:passed`; `outside:true` reading a fake canary outside temp copy |
| Relative command path escape | FAIL | Follow-up corrected traversal probe: `dotdot command status=passed outsideCanary=true` |
| Target `..`, absolute path, symlink root | FAIL | `dotdot-target` and `absolute-target`: `status:passed,outside:true`; `symlink target root status=passed outsideCanary=true` |
| Rerun event metadata | PASS | `source:sandbox,actor:ci,type:test,provenance:observed,signal:rerun,rerun_of:original`; same metadata on timeout/crash results |
| Live duplicate input, twice | FAIL | Both real CLI runs exit `1`; `Link failed for events; check migration and access.`; both leave `events=0 edges=0 seq=[] unique=0` |
| Live unique input, twice (supplementary control) | PASS | Both exit `0`; each `events=3 edges=1 seq=[1,2,3] unique=3`; `unique replace byte-identical=true` |
| Publishable-key visibility while temp rows exist | PASS | `RLS temp events=0 edges=0 errors=false` |
| Live failure after deletes | FAIL | Existing `3 events/1 edge` became `0/0` after duplicate input failed; no rollback |
| Live cleanup and fixture preservation | PASS | `CLEANUP PASS counts={"events":5,"edges":1,"entities":1}`; `fixture rows unchanged=true` |
| Fixture dry-run | PASS | `events: 5` / `edges: 2` |
| Tracer and dependencies unchanged | PASS | `git diff --exit-code HEAD -- packages/link/src/tracer.ts package.json package-lock.json` exit `0`, no output |
| Exclusive builder authorship across concurrent work | NOT_RUN | No isolated builder commit/baseline supplied; shared worktree changed during review. Do not attribute ignored builders' changes to Slice 5 |
| Rendered Replay with hypothetical two-edge live fixture | NOT_RUN | Fixture writes prohibited; compatibility judgment below is based on actual source, not a browser claim |

## Findings

| ID | Severity | File / location | Consequence and evidence | Safest minimal fix; do not implement in this review |
|---|---|---|---|---|
| F1 | High | `packages/cli/src/link.ts:67–80,126–141` | F6 is unmet. Identical delivered IDs are retained, get different seq values, and cause the bulk event insert to fail. Reproduced live, including after a successful load, which erased the prior temp session. | Dedupe by ID before sorting, assigning seq, and linking. Accept identical deliveries once; reject conflicting same-ID payloads before writes. Also implement F2; dedupe alone does not make replacement safe. |
| F2 | High | `packages/cli/src/link.ts:126–141` | Separate HTTP mutations delete edges, delete events, insert events, then insert edges. Failure after deletion destroys existing data. Failure inserting edges leaves new events with no edges. Interrupted edge deletion can leave old events with only some edges. Multi-session runs can replace some sessions before another fails. | Tech Lead review required: transactional service-role RPC for validated whole-session replacement, with per-session serialization and rollback. This changes the DB contract and needs an approved migration. Simple insert-first fails with existing global IDs and `unique(session_id,seq)`; a new seq alone does not resolve ID conflicts. Versioned staging plus atomic switch is larger. Preflight validation is useful but cannot guarantee recovery from network/database failure. |
| F3 | High | `packages/link/src/rerun.ts:44–65,76–78,145–151`; `packages/cli/src/rerun.ts` | A temp working directory is not filesystem isolation. Arbitrary shell commands read outside it with absolute and relative paths. A symlink used as the target root is followed by `readdir`, despite skipping symlink entries. Fake outside canary was read successfully; actual keys were never probed. Code can therefore read host credentials or write host files. | Use a reviewed execution boundary restricting filesystem and network access, with read-only approved input and writable temporary storage. Validate/realpath the target against an explicit allowed root. String rejection of `..` cannot contain arbitrary shell/Node code. C6's listed env/copy/timeout/cap controls mostly work, but they do not establish this boundary. |
| F4 | High | `packages/link/src/rerun.ts:83–115` | `finish()` clears both timers on shell close. A child with ignored stdio and `unref()` survives parent exit, so it can continue reading/writing after the run returns and after temp cleanup. Reproduced; reviewer killed it. Normal hanging process-group timeout did kill both parent and child. | Terminate remaining process-group members on every completion path and wait for teardown before cleanup. A proper execution boundary must also prevent detached/session-escaping descendants from surviving. |
| F5 | Medium | `packages/link/src/rules.ts:207–209`; `packages/link/tests/rules.test.ts` | Real linker emits pass→failure verifies with no edit. This violates the requested rule-5 acceptance condition. Current two-event unit test explicitly expects this behavior, so green tests hide it. Fixture tracer's two-test compatibility is separately intentional. | Remove the no-edit fallback from real rules and update its test. Keep fixture-only `linkTracer` untouched. |
| F6 | Medium | `packages/link/src/rules.ts:24–112,181–215` | Public pure linker assumes one session. Global prompt state, tool pairing, overlap search, rerun confirmation, and command failure map can join different sessions. Mixed-session probe generated such edges. CLI currently partitions sessions, which limits exposure on that path. | Partition/dedupe input by session before applying any rule, or enforce a checked single-session contract. Match reruns within the same session too. |
| F7 | Medium | `packages/link/src/rules.ts:201–214,222–229` | Edge-ID dedupe is too late: duplicate edit input creates self-supersedes `a→a`. Cited IDs are real but the relation is false. | Dedupe input IDs before rule evaluation, reject conflicting copies, and prohibit self-supersedes as a defensive invariant. |

## Live write evidence and restoration

- Service-role script asserted hostname `hivfaqlabtbrhrviwrrm.supabase.co` before creating clients. No other project was contacted.
- Session: **`verify-tmp-slice5` only**. Event IDs were namespaced with that session. Existing temp-session rows would have caused refusal before any mutation.
- JSONL source order: pass, edit, failure, duplicate edit. All fields satisfied the event/table shape; producer seq was deliberately advisory (`99`). No test files or patch ID were required by rule 5.
- Exact safe output from the real CLI write path:

```text
BASELINE counts={"events":5,"edges":1,"entities":1}
CLI dry-run exit=0 events: 4 | edges: 2
after dry-run events=0 edges=0 seq=[] unique=0
CLI write exit=1 events: 4 | edges: 2 | Link failed for events; check migration and access.
duplicate attempt 1 events=0 edges=0 seq=[] unique=0
CLI write exit=1 events: 4 | edges: 2 | Link failed for events; check migration and access.
duplicate attempt 2 events=0 edges=0 seq=[] unique=0
CLI write exit=0 events: 3 | edges: 1
unique control 1 events=3 edges=1 seq=[1,2,3] unique=3
RLS temp events=0 edges=0 errors=false
CLI write exit=0 events: 3 | edges: 1
unique control 2 events=3 edges=1 seq=[1,2,3] unique=3
unique replace byte-identical=true
CLI write exit=1 events: 4 | edges: 2 | Link failed for events; check migration and access.
duplicate after successful data events=0 edges=0 seq=[] unique=0
CLEANUP PASS counts={"events":5,"edges":1,"entities":1}
fixture rows unchanged=true
```

- Cleanup ran in `finally`: delete temp-ID edges by src/dst, then temp-session events. All three table snapshots were sorted and compared by SHA-256 before/after; every baseline row matched. No entity was inserted or deleted. Fixture events/edges/entities were never written. Storage was not touched.
- The requested deduped live acceptance failed; the successful unique-only control does not repair or satisfy it.

## Fixture edge judgment

| Question | Judgment |
|---|---|
| Is the second `ran_test` edge correct? | Yes. Implementation rule 3 permits a later test naming the edited file. Fixture pass and patch both name `client.js`. The edge is `pass→patch`, `derived_by:rule-3-ran-test-v1`, inferred because there is no enclosing prompt span. |
| Why does the live fixture have one edge? | Its fixture-only `linkTracer` emits only verifies. Real `linkEvents` adds ran_test and uses a different deterministic verifies edge ID. Two edges are expected from the new rules. |
| Does Replay break? | No structural crash is apparent, but semantic UI breaks: `apps/web/replay/page.tsx:13` renders every edge as “Later passing check → patch.” Two edges produce duplicate-looking buttons for the same pass and patch; ran_test is mislabeled as verifies. General real-rule edges would be mislabeled too. No rendered/browser verification claimed. |
| Do tracer tests or smoke break? | Tracer tests passed `4/4` and use local fixture/linkTracer, not the live edge count. Smoke source checks that some cited verifies edge exists, not exactly one edge. Two correctly formed edges should not fail those checks. Hypothetical live two-edge smoke was not run because fixture replacement was prohibited. |
| Write two edges or keep one? | **Keep the live fixture at one edge.** Preserve the stable tracer sample. Keep correct rule-3 behavior for real sessions. Before exposing broader graphs, have the Replay owner filter/render relations explicitly, then approve any fixture replacement separately. |

## Scope and remaining decisions

- Slice implementation files inspected: `packages/link/src/{rules,rerun}.ts`, `packages/link/tests/{rules,rerun}.test.ts`, `packages/cli/src/{link,rerun}.ts`. No model logic, new dependency, or cross-package implementation was found in those files.
- Tracer source and dependency manifests matched HEAD. Capture, init, recorder, and other concurrent-builder changes were ignored as requested. Exclusive builder authorship outside the Files list cannot be proven from this shared uncommitted worktree.
- Reviewer repository change: this file only. No code fixes, installs, commits, pushes, deployments, or fixture-session writes performed.
- Open: Tech Lead must choose the filesystem/process execution boundary and approve atomic replacement's database contract. Builder must fix F1–F7; a fresh reviewer must rerun the failed probes before release.
