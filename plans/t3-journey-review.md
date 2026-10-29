# T3 adapter + development journey: independent review

Verdict: **PASS WITH FIXES.** All checks are green. No path traversal, no write to the T3 DB, no SQL injection. Four confirmed correctness or product-rule bugs need a fix before the T3 journey is shown as evidence.

Reviewer: Sonnet 5.5, a different session from the builder. Date 2026-10-29. Nothing was edited or committed except this file.
Note: `apps/web/journey/build.ts` changed on disk during review (mtime 08:27). `test:journey` and `check` were re-run after that and are still green. The chain and label findings below were checked against the current file.

## Commands run (output tails)

| Command | Result |
|---|---|
| `npm run check` | `tsc --noEmit`, no errors |
| `npm run test:t3` | 1 file, 14 tests passed |
| `npm run test:journey` | 1 file, 10 tests passed (re-run after the build.ts change) |
| `npm run test:replay` | 4 files, 21 tests passed |
| `npm run test:recruiter` | 1 file, 37 tests passed |

Real-data smoke (read-only): `cli.ts list` listed threads. `cli.ts import --thread 9c32b718-… --out /tmp/review-t3` gave 645 events with unique ids in time order.
Counts: 19 prompts (all `developer`, `createdBy=user`), 326 tool calls, 13 agent edits, 212 `file_edit` marked `unknown`/`inferred`, 55 checkpoints, 20 tests (6 failed, 6 passed, 8 unknown).
I did not run the Next.js server or view the page in a browser.

## Confirmed bugs (ordered by severity)

1. **Non-test shell commands become "test" events with an invented pass/fail status.** `packages/t3/src/map.ts:206` uses `isTestCommand` (`packages/capture/map-hook.ts:3`). The regex matches `npm test|vitest|pytest` anywhere in the string.
   T3 shell commands are long compound scripts. In the real import these were classed as tests:
   - `cd …; grep -n "redactEditText(" …; cp …; sed -i '' …` → status `passed`
   - `cd …; sed -i '' 's/const clean = …/' packages/capture/handle.ts` → status `failed`
   - `cat /private/tmp/claude-…` → status `passed`
   - `D=…; mkdir -p …; cat > package.json <<EOF …` → status `unknown`
   Failure scenario: a `sed` edit whose output contains "N failed" becomes a "test failed" station. That station starts the failure-to-fix chain and the generated interview question ("The first failing test said …"). This shows a fabricated test result as observed.
   Fix: for `t3_code`, treat a command as a test only if the test runner is the command itself. Check the last segment, or the first token of each `;`/`&&` segment. Otherwise emit a `tool_call`. Also set `signal` per segment.

2. **Agent-written prompts are labelled "Developer prompt".** `apps/web/journey/journey.tsx:22` sets `KIND_WORD.prompt = 'Developer prompt'`. It is used at `journey.tsx:107` (aria-label) and `journey.tsx:361` (evidence panel `<h2>`). `build.ts` gives an agent-authored prompt `kind: 'prompt'` with the title "agent-written prompt".
   Failure scenario: a T3 thread with a `createdBy=agent` prompt shows "Developer prompt · 0:12" in the panel heading and "Developer prompt: agent-written prompt" for screen readers. The card below says "Written by an agent", so the page contradicts itself. This breaks the rule that agent prompts must not be shown as the developer's words.
   Fix: add a station kind `agent_prompt` (or pick the label from `station.title`). Use a different mark and legend entry. Add a test with `actor:'agent'`.

3. **`buildChain` puts "First attempted fix" after "Developer response".** `build.ts:447` takes the first edit after the failure. It ignores a developer response that came before that edit.
   Probe: events `test failed → developer prompt → agent edit → test passed` give `first_fix = edit`, `response = prompt`, and the strip numbers them 2 and 4, but the response happened first. This is the usual T3 shape (a run ends on a failure, the developer says "fix it", the next run edits). The edit is mislabelled as a first attempt, and "Still failing" says "The first fix passed".
   Fix: look for `response` first. If a response comes before the next edit, set `first_fix = null`, put that edit in `revised_fix`, and say "no fix attempt before the developer response".

4. **An agent-written prompt hides the developer's response.** `build.ts:301` clears `failedSincePrompt` on every prompt, including agent ones. A later developer prompt then gets kind `prompt`, not `response`.
   Probe: `test failed → agent prompt → developer prompt → edit → test failed → edit → test passed` gives `response = null`. The chain says "No developer prompt after the failure" and the question `jq-response` is not generated. The statement is false.
   Fix: clear the flag only when `byDeveloper`.

## Confirmed, lower severity

5. **Home path leaks to the browser in `tool_call.title`.** `apps/web/journey/sources.ts:strip` redacts only `output, diff, prompt, command, git_diff, answer, text`. The import produced `title: "Read /Users/UmaYeruva/Code-Git-Repos/DevLens/plans/…"` (3 events). `payload.t3`, `basis` and `git_diff_basis` are also not passed through `redactPaths`. Fix: run `redactPaths` over every string value of the payload recursively. Not a secret, but the plan says no home paths.

6. **Race in source switching.** `apps/web/recruiter/journey-section.tsx:31` has no abort or "latest request" guard. Click source A (slow), then B. If A resolves last, A's data shows under B's radio button. Fix: use an `AbortController` or a cancelled flag in the effect cleanup.

7. **Test status is taken from output text even if the exit code contradicts it.** `map.ts:207` only uses `exit_code` when the output is unclear. A run that prints "5 passed" and then exits non-zero (coverage gate, teardown error) is shown as passed. Fix: if `status==='passed'` and `exitCode` is non-zero, use `unknown` with `signal:'provider_status'`. (All `exit_code` values in the smoke import were `null`, so this may never fire on this T3 version. The fix is cheap.)

8. **`/api/journey` source list is not guarded.** `apps/web/api/journey/route.ts:9` calls `listSources()` outside the try. `sources.ts:listSources` runs `JSON.parse` on each `capture.json`. One corrupt file gives a 500 and no source list, even for the golden take. Fix: wrap the per-folder parse and skip bad folders.

## Suggestions (not confirmed bugs)

- `store.ts` `REQUIRED` omits `deleted_at` (threads table) and `sequence` (`orchestration_events`), which `listThreads` and `projects` query. On a changed schema you get a raw SQLite error, not `T3SchemaError`. Add them to `REQUIRED`.
- `store.ts:projects` skips `project.deleted` with `continue`. A deleted project keeps its title and workspace. Use `found.delete(id)`.
- `readThread` selects model changes with `json_extract(payload_json,'$.id')`. `selection_changes` is not used by `mapThread`. Remove it, or confirm the key name, so it does not drift.
- 212 of 225 file changes in the smoke import are "unattributed" (the checkpoint lists files that no provider edit names). The wording is correctly hedged, and each file is flagged `inferred`. But a Bash `sed`/`cp` by the agent is the likely cause, and the journey will show a wall of "?" stations. Consider grouping them per checkpoint in the UI, and counting files changed by a `command_execution` in the same run as "possibly by command".
- `map.ts:131` `tsOf` falls back to `item.updated_at` when `startedAt` and `completedAt` are missing. That can be much later than the real time. Mark such events (`ts_basis:'updated_at'`) or say so in `unknowns`.
- `build.ts:267`: `checkpoints` is cleared only on a prompt. Today a checkpoint is added only while edits are pending, so no duplicate arises. If an agent run continues without a prompt, one checkpoint could be attached to two edit stations. Clear it in `flush()`.
- `journey.tsx:309`: `key={str(file.path)}` is not unique when `path` is null. Use the index as a fallback.
- `journey-section.tsx:94` the source switcher uses `role="radiogroup"` and `role="radio"` but has no arrow-key movement. Use plain toggle buttons with `aria-pressed`, or add roving tabindex.
- `media/route.ts` reads the whole video into memory for each request. It is fine for a local demo; use a stream for large files.

## Checked and found OK

- **Read-only DB:** `new DatabaseSync(path,{readOnly:true})`. Every query is a fixed string or uses `?`. The `PRAGMA table_info(${table})` interpolation uses constant table names only. No writes.
- **Path traversal:** `t3Dir` checks the regex `^[A-Za-z0-9._:%-]{6,300}$` and `!includes('..')`, then `path.dirname(dir) === t3Root()` and requires `capture.json`. No `/`, `\` or NUL can pass. `%` is not decoded again. The media route gets only a thread id and a fixed file name. Range parsing rejects bad ranges with 416.
- **Attribution in the mapper:** `createdBy !== 'user'` gives actor `agent` (or `unattributed`), so the default is the safe side. No other `developer` actor is created. Agent-written prompts are noted in `unknowns`.
- **Redaction:** `cli.ts` redacts with `redactValue` before any write, including the git diff. Keys stay server-side. The browser only gets `/api/journey` output.
- **Separate evidence kinds:** checkpoints are `type:'checkpoint'`, `actor:'tool'`, labelled "(git)". Unattributed edits are `actor:'unknown'`, `provenance:'inferred'`. They are not merged into agent edits.
- **IDs and ordering:** `t3:<thread>:<turn_item_id>` and `…:unattributed:<checkpoint>:<path>` are stable. 645 ids unique. Events in time order.
- **Station semantics:** groups (`actions`, multi-edit, `switch`, `start`, response label) carry a `derived` text that the panel shows. Every station holds real `event_ids`. Observed and inferred chips are separate.
- **Golden path:** `test:replay` (21) and `test:recruiter` (37) pass. I did not run `npm run fixture:verify -- broken-api`.
- **UI text:** no score, rank or verdict wording found in the journey files. The footer says "A station is not a cause." and "A link is not a cause."
- **A11y basics:** stations are `role=button`, `tabIndex=0`, `aria-label`, `aria-pressed`, Enter and Space handled. Marks differ in shape as well as colour. Fix bug 2 for the aria-label text.

## Suggested order

1. Fix bug 1 and add a regression test with a compound `sed`/`grep` command.
2. Fix bug 2 (label and mark).
3. Fix bugs 3 and 4 with the two probe sequences above as tests in `build.test.ts`.
4. Fix bugs 5 to 8.
5. Have a different session re-run the five commands and `fixture:verify -- broken-api`.
