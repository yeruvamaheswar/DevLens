# Slice 7 review — Agent wiring and question queue, off by default

Independent review of the Slice 7 diff. This session did not write the product code. No product source was edited. No package was installed. No commit. `apps/web/next-env.d.ts` was ignored.

The spec is the Design section in `plans/review-questions-overnight.md`. The "Revised again 2026-10-27" bullets win. The Slice 7 Files and Accept lines are the pass bar. Contract rows: REQ-25, REQ-26, NOT-7, NOT-8, NOT-10, DEC-15, EVAL-25. Earlier design reviews: `plans/agent-design-review.md` and `plans/agent-design-recheck.md`.

Checked files: `git diff` of `packages/capture/hook.ts`, `apps/web/record/page.tsx`, `apps/web/app/globals.css`, `README.md`, `.env.example`, plus `packages/agent/src/cli.ts`, `packages/capture/agent-hook.test.ts`, `apps/web/api/agent/`, `apps/web/app/api/agent/`, `apps/web/record/agent-queue.tsx`, and `apps/web/record/agent-queue.test.ts`.

`npm run build`, `check:bundle`, and `demo:smoke` were not run. The review task left `.next` to another session.

## Checks

### 1. Thursday demo with the opt-in off

`processHook` (`packages/capture/hook.ts:37`) calls `handleHook` and then decides whether to spawn. A temp-dir probe called `handleHook` and `processHook` with the same `now` and compared the `events.jsonl` bytes.

The bytes matched for `UserPromptSubmit`, `PreToolUse`, `Edit`, `Bash`, `PostToolUseFailure`, `Stop` with no `agent.json`, `Stop` with `{"enabled": false}`, `Stop` with `{"enabled": "yes"}`, `SessionEnd` with `{"enabled": true}`, and `Stop` with `stop_hook_active: true` and `{"enabled": true}`. `Stop` with `{"enabled": true}` also matched, and the fake spawner was called once. Spawn does not change the stored line.

A real CLI `Stop` with the opt-in off exited 0. Stdout and stderr were empty. The stored event matched `handleHook` on every field except `project_id` and `raw.cwd`, which were the two different temp directories.

`apps/web/record/page.tsx` adds the `AgentPanel` import and one `<AgentPanel />` between the recorder section and the consent section. Phase words, record buttons, and consent lists are unchanged. `AgentPanelView` (`apps/web/record/agent-queue.tsx:147`) adds the pop-up and the queue only when `phase === 'on'`. Loading, off, and unavailable render the toggle button alone. The idle-phase test in `agent-queue.test.ts` compares that render with the previous `Recorder` HTML plus the toggle. The same component is what the other recorder phases mount, and the page diff has no other markup.

New CSS is appended at `apps/web/app/globals.css:1939`. Every new selector starts with `.agent-`. None restyle an existing class.

### 2. Hook

`DEVLENS_AGENT=1` is handled at `packages/capture/hook.ts:60`, before `readFileSync` of stdin and before `processHook`. A CLI probe with the opt-in file set to `{"enabled": true}` exited 0, stdout was empty, and `.devlens/events.jsonl` was not created.

Spawn runs only after the Stop event is appended, and only when both the raw payload and `event.payload.hook_event_name` are `Stop`, `stop_hook_active` is not `true`, and `agent.json` parses with `enabled === true` (`hook.ts:20`, `hook.ts:39`). `SessionEnd` and `stop_hook_active: true` did not spawn. The child is `process.execPath` with the tsx loader and `packages/agent/src/cli.ts`, then `projectDir`, `session_id`, and `event.id`. Options are `{ detached: true, stdio: 'ignore' }`, then `unref()` (`hook.ts:45`). A spawner that throws is caught, one stderr line is reported, and the hook returns the event (`hook.ts:48`). `cli.ts` calls `runAtStop` and exits 0 from `finally`.

`node node_modules/tsx/dist/cli.mjs` sets `process.argv[1]` to the script, so `cli.ts` reads `projectDir`, `session_id`, and `stop_event_id` from `argv.slice(2)`. The live probe confirms that wiring.

### 3. Route

`projectDirFromEnv` (`apps/web/api/agent/state.ts:16`) reads only `DEVLENS_PROJECT_DIR`. A blank value is unset. The POST body is not used as a path. `applyPost(null, ...)` returns 503 and does not write. POST requires a content type starting with `application/json` (415), an object body, `enabled` as a boolean for `opt_in`, and for `answer` a known `devlens_question` id (404), `action` of `answer` or `skip`, text at most 4000 characters, and no existing `<question_id>:answer` (409).

The answer event matches the winning bullet: id `<question_id>:answer`, `actor: 'developer'`, `type: 'answer'`, `source: 'devlens_question'`, `provenance: 'observed'`, null recording fields, and payload `question_id`, `text`, `answered_at`, `delivery`, `actor: 'developer'`, `action`. A skip stores `text: ''`. Delivery is `post_session` when that session has a `SessionEnd` stop, and `live` otherwise (`state.ts:103`).

A temp probe posted an answer containing `ANTHROPIC_API_KEY`'s value. Status was 200. The events file contained `[REDACTED]` and did not contain the value.

`apps/web/record/page.tsx` and `apps/web/record/agent-queue.tsx` do not read `process.env` and do not name `SUPABASE_SECRET_KEY` or `ANTHROPIC_API_KEY`. The route module is imported by `apps/web/app/api/agent/route.ts` (a server route) and by the Vitest file. It is not imported by a client component. `check:bundle` was not run.

### 4. UI

The pop-up is a `div` in normal flow (`agent-queue.tsx:160`, CSS at `globals.css:1957`). There is no dialog, no `aria-modal`, and no focus call or `autoFocus`. The region is `role="status"` and `aria-live="polite"`, and it is mounted while the opt-in is on before a later question fills it. `POPUP_MS` is 10000 (`agent-queue.tsx:13`). Clearing `popupId` puts the item in the queue. The toggle, the queue section, the answer field, and the Answer and Skip buttons have accessible names. `startPolling` runs only after a successful load with `enabled: true` (`agent-queue.tsx:86`). Off and unavailable clear the interval.

The queue stores `asked_at` and the answer's `answered_at` and `delivery` on the event. The list does not render those words. The winning event-mapping bullet requires them on the payload, and `state.ts:104` writes them.

### 5. Live probe

Temp project: `/var/folders/c4/zd_gcgn532105p93s62s1cvh0000gn/T/devlens-slice7-probe-78ql2v`. Outside the repo. `.devlens/agent.json` was `{"enabled": true}`. `events.jsonl` had one prompt and one `file_edit` for session `sess-probe`, plus `src/orders.js`. The repo had no `.devlens` directory. The shell had no `ANTHROPIC_API_KEY`.

Command: `npx --no-install tsx packages/capture/hook.ts` with `CLAUDE_PROJECT_DIR` set to that temp folder and stdin a `Stop` payload for `sess-probe` (`stop_hook_active: false`). `--no-install` used the repo's tsx and did not install a package.

The hook exited 0 in 985 ms. Stdout was empty. Stderr was empty. About 6 s after that exit, `events.jsonl` had types `prompt`, `file_edit`, `stop`, `question`. The question:

- id `sess-probe:devlens_question:sess-probe:Stop:p1`
- actor `tool`, source `devlens_question`, provenance `inferred`
- `recording_ref` null, `media_offset_ms` null
- cites `sess-probe:UserPromptSubmit:p1` and `sess-probe:tu2:post`
- route `claude_cli`, model `claude-sonnet-5-5`
- text: "You asked for an empty list on an empty cart, and the edit added `return []`. But orderTotal in src/orders.js now returns 0. How did you decide between a list and a number for the empty case?"

The ledger has a `reserved` line, then a `result` line with `ok: true`, `route: claude_cli`, `duration_ms: 4906`. No prompt text. One `claude -p` call. The hook had already exited.

## Minor

### 1. A failed `spawn` of `node` itself exits 1

`packages/capture/hook.ts:45`. The `try/catch` at `hook.ts:48` handles a synchronous throw. `child_process.spawn` reports a failure to start the executable with an `error` event, and this call does not listen for it. Node then prints a stack and exits 1.

Reproduced outside the hook with `spawn('/nonexistent/devlens-hook-bin', ...)` using `{ detached: true, stdio: 'ignore' }` and `unref()`. Exit code was 1. The same options with `process.execPath` and a missing script exited 0: Node starts, and the missing script fails in the child. The hook spawns `process.execPath`, so a missing `tsx` file takes that second path. The opt-in-off path never calls `spawn`.

Failure: `spawn(process.execPath)` fails with `EMFILE` or a bad `execPath` while the opt-in is on. The Stop hook prints a stack and exits 1.

### 2. A failed first GET mislabels the toggle and does not retry

`apps/web/record/agent-queue.tsx:72`. The `catch` sets `error` and returns. `phase` stays `loading`, and `startPolling` is not reached. `toggleLabel` (`agent-queue.tsx:131`) treats that error as `Question agent: Off (could not save the setting)`. The alert text is rendered only when `phase === 'on'` (`agent-queue.tsx:165`), so the "will try again" sentence is not shown. A later successful poll does retry once the interval is running.

Failure: `/api/agent` is down on the first load. The toggle says the setting could not be saved. The page does not poll until reload.

## Commands

`npm run -s check` exited 0 and printed nothing. `tsc --noEmit` is quiet on success. The later commands ran, so the `&&` chain had passed `check`.

`npm run -s test:capture`

```
 Test Files  2 passed (2)
      Tests  30 passed (30)
   Duration  923ms
```

`npm run -s test:record`

```
 Test Files  7 passed (7)
      Tests  45 passed (45)
   Duration  452ms
```

`npm run -s test:replay`

```
 Test Files  4 passed (4)
      Tests  21 passed (21)
   Duration  228ms
```

`npm run -s test:agent`

```
 Test Files  1 passed (1)
      Tests  57 passed (57)
   Duration  4.95s
```

The combined command exited 0.

Verdict: PASS
