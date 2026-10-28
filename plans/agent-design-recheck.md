# DevLens Agent design recheck

Independent recheck of the revised Design section and the Slice 6 and Slice 7 Accept lines in `plans/review-questions-overnight.md`. The revision begins "Revised 2026-10-27 after the Grok design review". Compared with `plans/agent-design-review.md` and with CR-7 in `plans/devlens.contract.md` (REQ-25, REQ-26, NOT-7, NOT-8, NOT-10, DEC-15). `claude --help` and `claude --version` were read on this machine. `claude -p` was not run.

## 1. Previous findings

| Finding | Result |
|---|---|
| Blocker: bare `claude -p` still has tools | Closed |
| Major 1: reads can leave the repo; `git ls-files` is a shell | Closed |
| Major 2: detached Stop can stall Claude, recurse, or skip the ledger | Not closed |
| Major 3: Slice 7 cannot find the project, the queue, or a valid event | Not closed |
| Major 4: opt-in off does not keep Thursday's `/record` page | Not closed |

**Blocker, closed.** The CLI engine is `execFile` with no shell. The argv includes `--tools ""` and forbids `--bare`, `--allowedTools`, `--fallback-model`, and `--add-dir`. The working folder is an empty temp folder. The env adds `DEVLENS_AGENT=1`. Slice 6 asserts that argv. Help says `--tools ""` disables all tools, and `--permission-prompts none` denies anything that would prompt.

**Major 1, closed.** The context builder uses an `fs` walk, not `git` and not a shell. A file is read only when its `realpath` stays inside the `realpath` of `projectDir`. Secret paths are `.env*` except `.env.example`, `*.pem`, `*.key`, and anything under `.ssh/`. The whole prompt is redacted, and the kept text is redacted again. The system prompt says event and file text are data, not instructions. Slice 6 asserts the path rules.

**Major 2, not closed.** Recurse and the ledger are specified: `DEVLENS_AGENT=1` exits 0 before any write; spawn only for `Stop`, never `SessionEnd`, never when `stop_hook_active` is true, and only with the opt-in on; `detached`, `stdio: 'ignore'`, `unref()`, stdout empty; a `reserved` ledger line with `session_id` is taken under a `wx` lock before the call; cap 30; no retry and no second route.

Two obligations from this finding are still absent:

- A spawn error is not required to be stderr only and then exit 0. The success path cannot stall Claude. A thrown spawn still can. Slice 7 cannot edit `handle.ts`. The exit-0 catch in `packages/capture/hook.ts` wraps only `handleHook`.
- The child argv still does not receive `projectDir` from `projectDirFrom`. `runAtStop` takes `projectDir`, and the hook is the process that has resolved it.

**Major 3, not closed.** The route half is specified: the Next server reads only `DEVLENS_PROJECT_DIR`, and an unset variable writes nothing. `appendEvent` is named for the question and for the answer. The pop-up is not modal, does not take focus, and moves to the queue after 10 seconds. Delivery is `live` during the session and `post_session` after it.

These gaps from the finding remain:

- The hook still does not pass the resolved project directory to the agent. The README is not required to say `DEVLENS_PROJECT_DIR` must be the same directory as `CLAUDE_PROJECT_DIR`.
- The design still does not say how `/record` hears about a new line. No poll and no read are specified. The route bullet covers only the unset variable.
- The stored question is not mapped to a valid `Event`. `appendEvent` fills `seq` only. Still absent: id `${session_id}:devlens_question:${stop_event_id}`, `actor: 'unknown'`, no `payload.attribution`, `recording_ref: null`, `media_offset_ms: null`, and payload `{ text, cites, stop_event_id }`. The answer is not specified as `ChoiceAnswer` (`question_id`, verbatim `text`, `answered_at`, `delivery`, `actor: 'developer'`). A skip is not `text: ''` and `skipped: true`. The queue is not required to show the time and the delivery word. `PostSessionAnswer.delivery` is only `post_session`, so the live label has no specified payload.

**Major 4, not closed.** The on document is `{ "enabled": true }`. When that state is off, `/record` mounts no pop-up and no queue. Phase words, record buttons, and consent lists stay unchanged. The toggle is the only new control. A test must prove that. `demo:smoke --offline` does not. Slice 6 and Slice 7 both require the off state to make no call and to start nothing.

The off rule is still incomplete. The text says a missing, unreadable, or invalid file means off. It does not say a non-`true` value means off, in the hook and in `runAtStop`. `{ "enabled": false }` is valid JSON. That is the file a toggle writes when the developer turns the agent off.

New CSS is not required to use new class names. The `test:record` assertion is not required to compare the off tree to today's `Recorder` plus that toggle. Slice 7 edits `apps/web/app/globals.css`. A class override can change the page while the stated checks still pass.

## 2. CR-7

The revision adds no new contradiction with REQ-25, REQ-26, NOT-7, NOT-8, NOT-10, or DEC-15.

| ID | Check |
|---|---|
| REQ-25 | Separate process, one Stop, read-only context, may ask nothing, cites event ids, off unless `/record` opts in. Matches. |
| REQ-26 | 10-second pop-up, then a queue, not modal, answer or skip, time and delivery stored. The queue label is unspecified (major 3). The text does not say the opposite. |
| NOT-7 | Opt-in, cap 30, ledger line before the call, zero retries, no route switch. A blank `ANTHROPIC_API_KEY` counts as unset. Matches. |
| NOT-8 | Hook stdout stays empty and the child stdio is ignored. A question that names a fix is dropped. Matches. |
| NOT-10 | No shell, no secret-file read, no tools on the model, no score, rank, or hire verdict. Matches. |
| DEC-15 | Default route is `claude -p` with the machine login. The API is used only when the key is set. A failed call is not retried and does not change route. `--bare` and `--fallback-model` are forbidden. Matches. |

The visible toggle was already in the design the first review scored. That review treated off-by-default as matching CR-7. This revision does not add a new conflict with "the Thursday demo is unchanged."

## 3. CLI argv

Installed Claude Code: 2.1.310. The same version the Design names. Each flag below is in `claude --help`.

| Argv | Help |
|---|---|
| `-p` | `--print`. Prints the response and exits. Works with a pipe. |
| `--model` | Sets the model. Help does not list model ids. `claude-sonnet-5-5` was not checked with a live call. |
| `--tools ""` | `""` disables all tools. |
| `--system-prompt` | Replaces the system prompt. |
| `--output-format json` | Choices include `json`. Only works with `--print`. This flag was added in the revision. It does not turn tools back on. |
| `--permission-prompts none` | With `--print`, `none` denies anything that would prompt. |
| `--strict-mcp-config` | Uses MCP servers only from `--mcp-config`. That flag is not in the argv. |
| `--setting-sources project` | Sources are `user`, `project`, and `local`. `project` is valid. |
| `--disable-slash-commands` | Disables skills and commands. |
| `--no-session-persistence` | Only works with `--print`. `-p` is present. |

The user message is not in the exact argv. `-p` accepts an optional prompt and is documented for pipes, so stdin fits `execFile` without a shell. The Design does not name stdin. That does not leave tools on.

Verdict: FAIL
