# Slice 3 re-verify: redaction fixes

Reviewer: independent re-verifier, not the builder. No product file was edited. Scratch scripts: `/tmp/s3-reverify-fuzz.mts`, `/tmp/s3-reverify-split.mts`. No real key values are printed. One `claude -p` run, inside `npm run probe:claude-hook`.

## Result table

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | `npm run check` | PASS | Exit 0. `tsc --noEmit` printed no errors. |
| 1b | `npm run test:capture` | PASS | Exit 0. `Test Files 1 passed (1)`, `Tests 16 passed (16)`. |
| 1c | `npm run probe:claude-hook` | PASS | One `claude -p`, `claude run 1: exit 0`. Then PASS for settings file, at least one event, supplied `session_id`, supplied `tool_use_id`, a test event, fake `sk-` marker absent, prompt `tool_use_id` null, no invented `exit_code`, user Claude settings unchanged. `PASS probe`. Exit 0. |
| 2 | Planted secrets through `hook.ts` stdin and `handleHook` | PASS | None of the planted secrets, their values, the zero-width form, the stripped zero-width form, or either half of an exact stdout/stderr split remained in `.devlens/events.jsonl`. `[REDACTED]` is present in `prompt`, `raw.prompt`, `raw.tool_input.command`, `raw.tool_input.nested.note`, `raw.tool_response.stdout`, `raw.tool_response.stderr`, `raw.error`, and `raw.last_assistant_message`. |
| 3 | Over-redaction | PASS | Every written line parsed as JSON. Frozen `now` (`2026-01-15T12:00:00.000Z`): `id`, `ts`, `type`, `tool_use_id`, `session_id`, `phase`, and `source` were byte-identical on the clean and dirty runs (`sess-struct:toolu_struct:post`, `tool_call`, `toolu_struct`, `sess-struct`, `post`, `claude_code_hook`). No structural field was rewritten. Stdin runs of the same pair differ only in `ts` (`2026-10-26T21:04:45.945Z` vs `2026-10-26T21:04:46.117Z`), which is the delivery clock. `NODE_ENV=production` and `A normal sentence containing the word token.` both survived. |
| 4 | `devlens init` | PASS | Fresh dir, two runs, exit 0 both times. SHA-256 `0492b9fa6a98343bd612a4dabb5034b9aaaae4b4f36356e439e16a85db87b8ed` both times. Hook events: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`. `SessionStart` absent. Merge dir: unrelated `permissions`, `env`, and `themeHint` kept; user `PreToolUse` matcher `Bash` command kept; `Notification` hook kept and not replaced. One DevLens handler per installed event. Second merge run, same SHA-256. |
| 5 | Malformed stdin | PASS | Empty and `{` : exit 0, stderr `devlens hook: stdin was not JSON`. `[1,2]`, `5`, `null`, and `"hi"`: exit 0, stderr `devlens hook: payload was not an object`. |
| 6 | Duplicate delivery (F6) | PASS (expected) | Same payload twice: exit 0, two JSONL lines, both id `sess-dup:UserPromptSubmit:prompt-dup`, seq 1 then 2. Ingest must dedupe by `id`. Not a redaction failure. |

## Prior findings

| ID | Re-check |
|---|---|
| F1 | Fixed. `SUPABASE_SECRET_KEY=<value>` and `"ANTHROPIC_API_KEY":"<4 char value>"` do not survive. Names may remain; values do not. |
| F2 | Fixed for the requested case. A 5-character secret planted in `FUZZ_SHORT_TOKEN` and in stdout is absent. |
| F3 | Fixed for the requested tokens: `ghp_` + 36 alphanumerics, `AKIA` + 16 uppercase alphanumerics, `xoxb-` token, `apikey=<value>`, `sk-ant-` key, JWT, zero-width `sk-ant-` key, and a key split exactly on the stdout/stderr boundary (env value and `ghp_` token). Full values and both halves are absent. |
| F4 | Fixed. Non-object JSON exits 0 and writes the stderr line. |
| F5 | Fixed. `SessionStart` is not registered. |
| F6 | Still true. Two deliveries append two lines with one id. Left for ingest. |

Also absent: `export MY_TOKEN=<2 char value>` and `Authorization: Bearer <token>`.

## Residual leaks

None. The planted secrets do not appear in the written JSONL.

## Verdict

**VERIFIED**

F1 through F5 are fixed. F6 behaves as specified: duplicate delivery writes two lines with the same id, and ingest still has to dedupe. That is not a Slice 3 redaction failure.
