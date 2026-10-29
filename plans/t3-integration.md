---
kind: report
title: T3 Code integration, recruiter journey, and SprintBoard demo
status: in progress
updated: 2026-10-29
---

# T3 Code integration, recruiter journey, and SprintBoard demo

Scope change: CR-11 in `plans/devlens.contract.md`. The Claude Code golden replay stays the verified demo and the fallback. The T3 path is experimental.

## Status

| Part | State | Evidence |
|---|---|---|
| Recruiter train line on `/recruiter` | built, unit tested, screenshot checked | 13 journey tests; headless Chrome screenshots of golden and T3 sources |
| T3 adapter (read-only, `packages/t3`) | built, experimental, reviewed | 16 tests; real imports of 3 T3 threads; review `plans/t3-journey-review.md` (PASS WITH FIXES, all 8 fixed) |
| SprintBoard demo app (`~/Code-Git-Repos/sprintboard-demo`, private GitHub repo) | built, verified | 31 tests; `check.mjs` 3 states match; live SQLite and Supabase API smoke |
| T3 rehearsal 1 on SprintBoard (agent-written prompts, Haiku 5.5) | real T3 chain captured | fail 400 → tempting fix → fail 0 of 3 → root fix → 26 pass; sandbox verify failed (no network for API tests), fixed by in-process tests; capture discarded |
| T3 rehearsal 2 on the new starter | real T3 chain, independently verified | fail 400 → fail 0 of 3 → 31 pass; sandbox re-run passed; rule-5 edges observed; saved as `examples/t3-captures/sprintboard-rehearsal` |
| Live T3 SprintBoard take by Uma | waiting on Uma | |
| GitHub | pushed | DevLens `main` (public repo); `yeruvamaheswar/sprintboard-demo` created private, `main` and tag `starter` pushed |
| Supabase table for SprintBoard | applied | `public.sprintboard_issues`, RLS on, no policies (server key only); seeded with 12 issues |
| Vercel deploy (DevLens, SprintBoard) | blocked on Uma | install the Vercel GitHub app; approve the connector's team access |

## Why the recruiter line was missing

Reproduced on 2026-10-29 08:07 with `next dev` on port 3100 and a headless Chrome screenshot.

1. `apps/web/recruiter/page.tsx` (CR-9) was a text feed of shared updates. It never imported the line component or read session events. The line existed only on `/replay`.
2. The feed reads only `DEVLENS_PROJECT_DIR`, which is unset in `.env`, so the page said "The recruiter view is not set up on this server" and drew nothing.
3. The top bar had no link to `/recruiter`.

Fix: a provider-neutral journey (`apps/web/journey/`) at the top of `/recruiter`. It reads local event files through `/api/journey`, so it does not depend on `DEVLENS_PROJECT_DIR`. The CR-9 feed is kept below it.

## T3 Code findings (T3 Code 0.1.3, checked on this Mac)

| Question | Finding |
|---|---|
| Projects, threads, sessions | A project is a workspace folder (`project.created` events). A thread is one conversation, with branch and worktree. A run is one turn, started by one user message. A provider session belongs to a thread and records cwd, model, and capabilities. |
| Provider invocation | Server-side drivers per provider instance: `claudeAgent`, `codex`, `cursor`, `grok`, `antigravity` (OpenCode, Pi, fx present but disabled here). Each provider session advertises a capability matrix. |
| Model selection | `modelSelection` = provider instance + model + options (effort, fast mode). Each run stores the selection it used. Changes emit `thread.model-selection-updated` and `thread.provider-switched`. |
| Where events live | Turn items: `user_message`, `command_execution` (input, output, sometimes exit code), `file_change` (file and a provider-shaped diff), `dynamic_tool`, `web_search`, `file_search`, `subagent`, `checkpoint`, approvals, errors, interrupts. Tests are not a first-class event: they are command executions. |
| Supported APIs | Authenticated RPC with subscriptions (`packages/contracts/src/rpc.ts` in T3). MCP tools for agents inside T3. The local SQLite store is internal, not a published API. No plugin API found. |
| Observe without changing T3 | Yes: read the SQLite store read-only, and read T3's hidden git checkpoint refs. Chosen for the demo. |
| Unavailable or inferred | The model the provider actually served. Token use and cost. Exit codes for most Claude commands. Edits outside the agent (only visible in checkpoints, so unattributed). Subagent edits in other threads. Test meaning. |
| Checkpoints, branches, worktrees | After each run T3 writes a hidden commit `refs/t3/orchestration-v2/checkpoints/<scope>/ordinal/N` (author "T3 Code", parent HEAD). `git diff N-1 N` is what changed during run N, whoever changed it. Worktree threads record `worktreePath`. A rollback reverts files and marks the run `rolled_back`. |

Architecture and event mapping: [packages/t3/README.md](../packages/t3/README.md).

## Setup

Node 24. No install needed beyond the existing `npm install` in DevLens. SprintBoard uses Node built-ins only.

```
# DevLens, from ~/Code-Git-Repos/DevLens
npm run demo                 # http://localhost:3000; uploads need DEVLENS_RECORD_ENABLED=1 and Supabase keys in .env
# SprintBoard, from ~/Code-Git-Repos/sprintboard-demo
bash ~/Code-Git-Repos/DevLens/examples/sprintboard-scenario/reset.sh   # back to the starter state and seed data
npm start                    # http://localhost:4200
```

In T3 Code: add the folder `~/Code-Git-Repos/sprintboard-demo` as a project. Pick one provider and model (for example Claude Sonnet 5.5).

## Live T3 take (Uma, before the Loom)

1. Open `http://localhost:3000/record`. Click **Record one window**. Pick the **T3 Code** window. Audio and camera stay off.
2. In T3 Code, start a new thread in `sprintboard-demo`. Prompt 1:
   > The In progress filter on the dashboard shows an error. Run npm test, find the cause, and make the smallest fix. Then run npm test again.
3. Wait for the run to end. If a test still fails, send prompt 2 (the developer response):
   > Still failing. The API returns 200 but no issues. Statuses are stored as in_progress. Normalize the API value once and use it in validation, the query, and create/update. Run npm test.
4. When `npm test` passes, stop the recording on `/record`. Review it. Click **Upload** (or **Delete** and start again).
5. Import, attach the take, and verify:
   ```
   npm run t3 -- list --workspace ~/Code-Git-Repos/sprintboard-demo
   npx tsx packages/t3/src/fetch-recording.ts --latest --thread <thread id>
   npm run t3 -- import --thread <thread id>
   npm run t3 -- verify --thread <thread id>
   ```
6. Open `http://localhost:3000/recruiter?source=t3:<thread id>`.

If the agent fixes everything in one run, the chain says "The first fix passed. No second failure." That is the truth of that take; do not re-prompt to stage a failure.

## Demo script (about 4 minutes)

| Time | Screen | Action and words |
|---|---|---|
| 0:00 | `/recruiter` | "DevLens records how a developer works with coding agents, and links every claim to an event. No score, no verdict." |
| 0:20 | T3 Code window | Show the thread: the prompt, the failing `npm test`, the developer's second prompt. "This is T3 Code. The developer picked Claude Sonnet for this thread." |
| 0:50 | `/recruiter?source=t3:<id>` | Point at the line. "Each station is a recorded event: prompts, agent actions, code changes, tests. The amber branch is a separate re-run." |
| 1:20 | Chain step 1 | Click **Original failure**. Show the assertion, the provider and model, and the T3 ids. Click **Play the recording**: the video jumps to that moment. |
| 1:50 | Chain steps 2-3 | Click **First attempted fix**: the diff. Click **Still failing**: the new assertion. |
| 2:20 | Chain step 4 | Click **Developer response**: the prompt word for word, labelled as derived by event order. |
| 2:45 | Chain steps 5-7 | **Revised code**: the diff and the git checkpoint diff, kept apart. **Passing test**. **Independent verification**: a sandbox worker, not the session. |
| 3:20 | Questions, unknowns | Read one question and its cited events. Point at the unknowns: the model is the one T3 recorded, not proven served. |
| 3:45 | Source switch | Click the verified Claude Code golden take. "Same page, a different capture tool." |
| 4:05 | End | "Evidence, not a verdict." |

## After the live take: show it on the hosted site

```
npm run t3 -- save --thread <thread id> --as sprintboard-live   # add --with-recording only if the video may be public
git add examples/t3-captures/sprintboard-live && git commit -m "Save the live T3 take" && git push
```

The hosted `/recruiter` then lists it as `t3-saved:sprintboard-live`.

## Fallback

If the live T3 take is not ready or not clean, two fallbacks exist. For T3: `/recruiter?source=t3-saved:sprintboard-rehearsal`, a real T3 session with agent-written prompts, labelled as such, independently re-run. For the verified path: the golden take, `http://localhost:3000/recruiter?source=golden` and `/replay`. Say that the T3 adapter is experimental. The golden take needs no network: `npm run demo -- --offline`.

## Test results (2026-10-29, this Mac)

| Command | Result |
|---|---|
| `npm run check` | no errors |
| `npm run test:replay`, `test:link`, `test:capture`, `test:record`, `test:sync`, `test:rerun`, `test:recruiter`, `test:agent`, `test:widget`, `test:questions` | 21, 13, 36, 61, 8, 14, 37, 60, 14, 91 passed |
| `npm run test:t3` | 16 passed |
| `npm run test:journey` | 13 passed |
| `npm run fixture:verify -- broken-api` | PASS |
| `npm run demo:smoke` (online) | 5 PASS: fixture, WebM header, Supabase fixture, RLS insert denial, signed private media |
| `npm run build && npm run check:bundle` | build OK; no server credential in client assets; golden files traced into `/api/replay`, `/api/replay/media`, `/api/journey` |
| SprintBoard `npm test` (starter) | 31 tests, 29 pass, 2 fail: `expected status 200 for status=in-progress, got 400` |
| `node examples/sprintboard-scenario/check.mjs` | starter fail 400, incorrect fix fail 0 of 3, final fix pass: all 3 match |
| SprintBoard against Supabase (`STORE=supabase`) | open 5, completed 4, in-progress 400 (starter bug), search 1, stats 12, create 201; table re-seeded |

Independent review: Sonnet 5.5, a different session (`plans/t3-journey-review.md`). Findings fixed: strict test-command detection, agent prompts as their own station kind, chain order when the developer answers first, agent prompts no longer hide the developer response, deep path redaction, source-switch race, exit code over output, guarded source list. Each has a regression test.

## Open

- Uma: the live T3 take, the Loom, the Airtable form, and the push decision.
