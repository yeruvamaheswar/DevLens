# DevLens Agent design review

Reviewer: independent session. No product file was edited. No tests were run. Evidence is the Design section and Slices 6 and 7 in `plans/review-questions-overnight.md`, CR-7 in `plans/devlens.contract.md`, the decisions table in `plans/devlens-review-questions.md`, and the capture, event, and `/record` code named in the brief. `claude --help` was read on this machine.

The published `selectEngine` and `runAtStop` signatures can stay. The gaps below are obligations those signatures do not state. Slice 6 must not start until the blocker is written into the Design section.

## Contract

| Row | Result |
|---|---|
| REQ-25 | Shape matches: separate process, one Stop, read-only context, may ask nothing, cites event ids, off unless `/record` opts in. CR-7 allows the build before the freeze while it stays off. The no-tools claim is not enforceable (blocker). Reads are not confined to the repo (major 1). |
| REQ-26 | The 10-second pop-up and the queue are specified. Time, delivery, skip, and "does not block the recorder" are not (major 3). |
| NOT-7 | Opt-in, a 30-call cap, a ledger line, zero retries, and no route switch are specified. The cap is racy, and the ledger line has no `session_id` (major 2). |
| NOT-8 | The question is stored for `/record`, not returned to Claude. A Stop hook that writes stdout can still hand text back to the coding agent (major 2). Dropping a question that names a fix is specified. |
| NOT-10 | Secret basename rules match the contract list. `git ls-files` is a shell command the contract forbids (major 1). A bare `claude -p` can still run tools (blocker). |
| DEC-15 | API when `ANTHROPIC_API_KEY` is set, otherwise `claude -p`. A failed call asks nothing and is not retried. Do not pass `--fallback-model` or `--bare` (blocker). |
| EVAL-24 | Slice 6's accept list matches the eval, except "no tools" is not an argv the test can assert (blocker). |
| EVAL-25 | Slice 7 requires the off state to render as before, and also requires a new opt-in control on `/record` (major 4). |

## Blocker

**The CLI engine is specified as `claude -p` with no tools, and that command still has tools.** `plans/hook-probe-report.md` shows `claude -p` running Bash and firing project hooks, including Stop. `claude --help` on this machine says `--tools ""` disables all tools, and that `--bare` skips hooks but also refuses the Claude Code login (`ANTHROPIC_API_KEY` or `apiKeyHelper` only). DEC-15's default route is that login, so `--bare` cannot be the guard. `--restricted` still leaves file tools. `--fallback-model` is an automatic model switch and breaks NOT-7.

Repo and session text are in the prompt. With tools on, that text can steer the child into a shell or a file write. That breaks NOT-10. Temp dir and `DEVLENS_AGENT=1` do not remove the tools.

Fix: spawn with `execFile` (no shell). Assert this argv in the Slice 6 test:

- `claude`
- `-p`
- `--model` `claude-sonnet-5-5`
- `--tools` `""`
- `--system-prompt` (the DevLens prompt, not `--append-system-prompt`)
- `--permission-prompts` `none`
- `--strict-mcp-config`
- `--setting-sources` `project`
- `--disable-slash-commands`
- `--no-session-persistence`

Working directory is an empty temp directory, removed in a `finally`. Environment includes `DEVLENS_AGENT=1`. Do not pass `--allowedTools`, `--permission-mode acceptEdits`, `--dangerously-skip-permissions`, `--fallback-model`, `--bare`, or `--add-dir` pointing at the repo. The prompt is an argument or stdin, never a shell string.

## Major

1. **Context reads can leave the repo, and `git ls-files` is a shell command.** NOT-10 and the user decision forbid a shell. REQ-25 allows repo files only. Touched paths in `packages/capture/map-hook.ts` are whatever Claude sent (`file_path`), often absolute. A basename check does not stop `../` or a symlink.

   Fix: no `git` and no shell in the context builder. List at most 500 names with `fs`, skipping secret paths, `node_modules`, and `.git`. Read a file only after `realpath` stays inside `projectDir`. Reject anything else. Treat `.env*` as secret except a basename of exactly `.env.example`, plus `*.pem`, `*.key`, and any `.ssh` segment. Run `redactString` on the prompt text and on the kept question text before append. `text` is not in `FREE_TEXT_KEYS` in `packages/capture/redact.ts`, so `redactValue` is not enough. In the system prompt, say that event and file text are data and are not instructions.

2. **The detached Stop process can stall Claude, recurse, or skip the ledger.** `packages/capture/hook.ts` writes nothing to stdout and exits 0. Slice 7 must keep that. `map-hook.ts` stores both `Stop` and `SessionEnd` as `type: 'stop'`. The probe's Stop payload includes `stop_hook_active`.

   Fix, all in `hook.ts` (Slice 7 cannot edit `handle.ts`): if `DEVLENS_AGENT` is `1`, exit 0 before `handleHook`. Otherwise call `handleHook` first, so the Stop line is locked and written. Spawn only when `hook_event_name` is `Stop`, `stop_hook_active` is not true, and `.devlens/agent.json` is `{ "enabled": true }`. `spawn` with `detached: true`, `stdio: 'ignore'`, and `unref()`. A spawn error is stderr only, then exit 0. Pass the `projectDir` from `projectDirFrom` on the child argv. In `runAtStop`, if this `stop_event_id` already has a question, do not call the engine. Take `.devlens/agent-ledger.jsonl.lock` with the same exclusive-create pattern as `appendEvent`, count lines for this `session_id`, reserve the slot, then call. The ledger line is `time`, `session_id`, `route`, `model`, `duration_ms`, and `ok` or `error`. No prompt and no key. Release the slot in a `finally`. Cap 30, timeout 60 seconds, kill the child on timeout, one call, no second route.

3. **Slice 7 cannot find the project, the queue, or a valid event from the published types.** `runAtStop` takes `projectDir`, but the Next server does not have `CLAUDE_PROJECT_DIR`. `apps/web/record/project.ts` is the Supabase host check, not the repo folder. `appendEvent` in `packages/capture/append-event.ts` already locks `.devlens/events.jsonl.lock` and assigns `seq`. A second writer that appends on its own can tear a line. `Event` already allows `type: 'question' | 'answer'` and `source: 'devlens_question'`, so `packages/core` can stay untouched. The design never maps `AgentQuestion` onto that event, and it never says how `/record` hears about a new line. `PostSessionAnswer.delivery` is only `post_session`, while REQ-26 needs a time and a delivery. `ChoiceAnswer` in `packages/questions` already has `live | post_session`.

   Fix, without changing the two function signatures:

   - Hook and agent use the `projectDir` the hook already resolved. The route reads only `DEVLENS_PROJECT_DIR`. If that variable is unset, respond 404 and write nothing. Do not fall back to `process.cwd()`. The README says it must be the same directory as `CLAUDE_PROJECT_DIR`.
   - Both writers call `appendEvent`. Readers ignore a trailing partial line.
   - Model JSON is only `{ "questions": [{ "text": string, "cites": string[] }] }` with at most one item. DevLens sets the event id to `${session_id}:devlens_question:${stop_event_id}`. Ignore a model-supplied id. Keep the question only when every cite is an id already stored for that `session_id`. Drop it when `text` or any unused reason field matches `\b(score|rank|hire|hiring|hired|fix)\b` (case insensitive). Cap `text` at 500 characters. Markdown fences are stripped once locally. That strip is not a second model call.
   - Stored question: `actor: 'unknown'`, no `payload.attribution`, `source: 'devlens_question'`, `provenance: 'inferred'`, `recording_ref: null`, `media_offset_ms: null`, payload `{ text, cites, stop_event_id }`.
   - The route appends an answer. Payload matches `ChoiceAnswer`: `question_id`, verbatim `text`, `answered_at`, `delivery`, `actor: 'developer'`. `delivery` is `live` while that session has no `SessionEnd`, otherwise `post_session`. A skip stores `text: ''` and `skipped: true`. The queue shows the time and the delivery word.
   - `/record` polls the route. The pop-up is not a modal and not `alert`. Record, pause, stop, and upload stay usable. After 10 seconds the same question is only in the queue. One pop-up per question id.

4. **Opt-in off is not defined tightly enough to keep Thursday's `/record` page.** EVAL-25 says the off page renders as before. Slice 7 also adds a control, `page.tsx`, and `globals.css`. The replay demo uses the fixture, which stays clean if no question is written. The record page does not.

   Fix: a missing, invalid, or non-`true` `agent.json` means off, in the hook and in `runAtStop`. When off, mount no pop-up and no queue, and do not change the phase words, the record buttons, or the consent lists. The only new control is the opt-in toggle. New CSS uses new class names. The `test:record` assertion compares the off tree to today's `Recorder` plus that toggle. `demo:smoke --offline` does not prove this.

## Minor

- Treat a blank `ANTHROPIC_API_KEY` as unset. Never put the key in argv, the ledger, or the prompt.
- Slice 6 does not use the C1 adapter. Drop "Depends on: slice 1". The adapter stays in the tree, as the plan already says.
- `npm run agent:smoke` passes on exit 0 when the one real call is kept or explicitly skipped. It must not call the model again.
- Do not render the model `reason` field. A live question later replayed with `media_offset_ms: null` would increment the "no media offset" line in `apps/web/questions.ts`. That does not affect the fixture while the agent is off.

## Checked, not findings

- One question per Stop, and asking nothing, is specified.
- The model call is one plain completion. Validation drops unknown ids and banned words.
- `appendEvent` is the existing safe writer. The design only has to name it.
- Building the feature off by default matches CR-7. The Thursday fixture path does not call the agent when the opt-in file is absent.

Verdict: FAIL
