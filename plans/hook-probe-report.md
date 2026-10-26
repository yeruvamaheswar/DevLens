# Claude Code hook probe — REPORT

Facts come from two real `claude -p` runs. Raw logs: `events.run1.jsonl` (fix flow, 10 events), `events.jsonl` (run 2, bare failing `npm test`, 6 events).
Probe dir: /tmp/devlens-hook-probe. Hooks: project-local `.claude/settings.local.json`, one command hook per event, no matcher.

## Commands that worked (OBSERVED)
    cd /tmp/devlens-hook-probe
    claude -p "<prompt>" --permission-mode acceptEdits --allowedTools "Bash(npm test)"
No dangerously-skip-permissions. No folder-trust prompt appeared; hooks fired in -p mode with no extra flag.
Note: `timeout` does not exist on macOS; do not use it.

## Hook names that fired (OBSERVED)
SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SessionEnd. All 7 fired. Order: SessionStart, UserPromptSubmit, (Pre, Post|PostFailure)*, Stop, SessionEnd. No duplicates seen.

## Common fields (OBSERVED, all events)
session_id, transcript_path, cwd, hook_event_name.
Most events also: prompt_id, permission_mode, effort {level}. (SessionStart has none of these; SessionEnd has prompt_id only.)
There is NO timestamp field in any payload. Hook script must stamp its own time. Only duration_ms exists on Post events.
cwd appeared as /private/tmp/... (macOS realpath of /tmp).

## Per-event extra fields (OBSERVED)
| Event | Extra fields |
|---|---|
| SessionStart | source ("startup") |
| UserPromptSubmit | prompt |
| PreToolUse | tool_name, tool_input (object), tool_use_id |
| PostToolUse | tool_name, tool_input, tool_response (object), tool_use_id, duration_ms |
| PostToolUseFailure | tool_name, tool_input, tool_use_id, error (string), is_interrupt, duration_ms |
| Stop | stop_hook_active, last_assistant_message, background_tasks, session_crons |
| SessionEnd | reason ("other" in -p) |

Bash tool_response keys (success): stdout, stderr, interrupted, isImage, noOutputExpected. There is NO exit_code field.
Edit tool_response keys: filePath, oldString, newString, originalFile, structuredPatch, userModified, replaceAll, contentNotInModelContext.

## Questions asked
- tool_use_id on Pre and Post: YES, present on PreToolUse, PostToolUse and PostToolUseFailure; same value pairs Pre with Post (toolu_...). OBSERVED.
- Failing `npm test` (run 2, bare command, exit 1): fires PostToolUseFailure, NOT PostToolUse. The pass/fail signal is the event name plus `error`, which starts with "Exit code 1\n\n" followed by the output. OBSERVED.
- Pitfall (run 1): the model ran `npm test 2>&1 | tail -30`. The pipeline exit code was 0, so a FAILING test fired PostToolUse, and the failure is visible only in stdout text ("ℹ fail 1", "✖"). So exit status alone is not a reliable signal when the command is piped. Parse test output (e.g. node test "ℹ fail N") as a fallback. OBSERVED.
- Passing run: PostToolUse, stdout contains "ℹ pass 1 / ℹ fail 0".
- Ordering: Pre always preceded its Post in the file; calls were sequential. Parallel tool calls and ordering under concurrency NOT tested (ASSUMED unknown).
- Folder trust: no prompt in -p mode. OBSERVED. Interactive mode NOT tested.
- Hook stdin arrives as one JSON document; hook is async-safe with a plain append.

## Not tested (ASSUMED / unknown)
Matchers, hook exit-code blocking, interactive mode, subagent events, SessionEnd reasons other than "other", PostToolUseFailure with is_interrupt true.

## Sanitized samples (session ids shortened, long strings trimmed)
SessionStart:
{"session_id":"ad320db3-…","transcript_path":"~/.claude/projects/-private-tmp-devlens-hook-probe/ad320db3-….jsonl","cwd":"/private/tmp/devlens-hook-probe","hook_event_name":"SessionStart","source":"startup"}

UserPromptSubmit:
{"session_id":"ad320db3-…","transcript_path":"…","cwd":"…","prompt_id":"d3de07fe-…","permission_mode":"acceptEdits","hook_event_name":"UserPromptSubmit","prompt":"Run npm test, fix …"}

PreToolUse:
{"session_id":"…","transcript_path":"…","cwd":"…","prompt_id":"…","permission_mode":"acceptEdits","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm test 2>&1 | tail -12"},"tool_use_id":"toolu_0188…"}

PostToolUse:
{"…common…","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"npm test 2>&1 | tail -12"},"tool_response":{"stdout":"✔ adds …\nℹ pass 1\nℹ fail 0 …","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},"tool_use_id":"toolu_0188…","duration_ms":248}

PostToolUseFailure:
{"…common…","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"npm test"},"tool_use_id":"toolu_…","error":"Exit code 1\n\n> probe@1.0.0 test\n> node --test\n\n✖ adds …\nℹ fail 1 …","is_interrupt":false,"duration_ms":…}

Stop:
{"…common…","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"`npm test` now passes. …","background_tasks":[],"session_crons":[]}

SessionEnd:
{"session_id":"…","transcript_path":"…","cwd":"…","prompt_id":"…","hook_event_name":"SessionEnd","reason":"other"}

## Redaction
Scanned events*.jsonl and this file for sk-/token/api_key/secret: no matches. Payloads contain a user home path and the prompt text only. No ~/.claude settings were changed.
