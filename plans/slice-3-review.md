# Slice 3 review: Claude Code hooks and redaction

Reviewer: Claude Sonnet 5.5, fresh session, not the builder. No code was changed. Scratch files are in `/tmp/s3r/`. No key values appear here.

## Result table

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | `npm run check` | PASS | `tsc --noEmit` printed no errors |
| 1b | `npm run test:capture` | PASS | 1 file, 6 tests passed |
| 1c | `npm run probe:claude-hook` | PASS | One real `claude -p`, exit 0. All 9 probe checks PASS, including "fake sk- marker is absent", "tool_use_id kept", "no invented exit_code", "user Claude settings were not modified" |
| 2 | Event design | PASS (2 minor notes) | See "Design check" below |
| 3 | Redaction before append, all fields | PASS | `handleHook` calls `redactValue` on the whole mapped event, then `appendEvent`. End-to-end fuzz put a key, a planted env value and a Bearer token in prompt, command, stdout, stderr, error, old_string, new_string, originalFile, last_assistant_message and reason. None leaked. `originalFile` is dropped from `raw` |
| 3b | Pattern fuzz | PARTIAL | Leaks listed in F1 to F3 |
| 4a | Hook never reads `.env`, never touches `~/.claude` | PASS | grep of `hook/handle/map-hook/redact/append-event` finds neither. Only `process.env` is read. `init` refuses `~/.claude` paths. Hashes of `~/.claude/settings*.json` unchanged |
| 4b | `devlens init` idempotent and merge-safe | PASS | Fresh dir: same SHA after run 1 and run 2. Dir with user keys and a user `PreToolUse` Bash hook: same SHA after 2 runs, `permissions`, `env`, `Notification` hook and the user hook survive, DevLens handler appears once per event (7 total). Invalid JSON: exit 1, file untouched |
| 5 | Real `hook_failure` path | PASS | 1 `claude -p`, bare `npm test`. Test event: `type:test`, `status:failed`, `signal:hook_failure`. Pre and post events share one `tool_use_id`. Ids: `<sid>:toolu_…:pre` / `:post`. No `exit_code` in the response |
| 6 | Failure behaviour | PASS | Empty stdin, invalid JSON, ENOENT on disk, read-only dir: each exits 0 with a `devlens hook: …` line on stderr. Gap: see F4 |
| 7 | Git status and ignore | PASS | Slice 3 files are only `packages/capture/*` and `packages/cli/src/init.ts` (untracked). `.devlens/` is ignored (`.gitignore:16`). No tracked file modified. Other untracked paths belong to the parallel builders |

Total `claude -p` runs: 2 (probe 1, hook_failure 1).

## Design check

Verified against `plans/devlens-architecture-review.md`:

- Ids are `<sid>:<tool_use_id>:pre|post` and `<sid>:<hook_event_name>:<prompt_id>`. Match.
- `ts` is stamped by the hook (`stampTs`, ISO UTC with ms). Match.
- `source:claude_code_hook`, `provenance:observed`, `recording_ref:null`, `media_offset_ms:null`. Match.
- Actor: prompt is `developer`. Tool, stop and test are `agent`. Match.
- `SessionStart` returns null and writes nothing. Match.
- `Stop` and `SessionEnd` give `type:stop` with `payload.hook_event_name`. Match.
- Post `Bash` with `npm test|vitest|pytest` gives `type:test`. `PostToolUseFailure` gives `failed/hook_failure`. A `PostToolUse` that cannot be parsed gives `unknown/output_parse`. Fuzz confirmed `unknown` for empty output. Never guessed as pass.
- No `exit_code` is stored.

## Findings

| ID | Severity | File | Consequence | Fix |
|---|---|---|---|---|
| F1 | Medium | `packages/capture/redact.ts` | Assignment lines are not redacted unless the value is in the hook's own env or has an `sk-` prefix. Fuzz: `SUPABASE_SECRET_KEY=hunter2hunter2` and `ANTHROPIC_API_KEY="shortkey"` pass through unchanged. A `cat .env` result would write the secrets to `.devlens/events.jsonl`. | Add a denylist rule: `/\b[A-Z][A-Z0-9_]*(KEY\|TOKEN\|SECRET\|PASSWORD)[A-Z0-9_]*\s*[=:]\s*\S+/g` and replace the value only. |
| F2 | Low | `redact.ts` | Env values shorter than 8 chars are not stripped (`MIN_SECRET_LENGTH`). Fuzz: `abc123` leaks. Risk: real, but most real keys are long. Stripping short values everywhere would corrupt structural fields (`id`, `type`, `session_id`, `tool_name`) and common words, because `redactValue` also rewrites object keys and ids. JSON stays valid, but the data gets wrong. | Strip values of 4 to 7 chars only inside free-text fields (prompt, command, stdout, stderr, error, `last_assistant_message`, diff), and only at token boundaries (`(?<![A-Za-z0-9])v(?![A-Za-z0-9])`). Skip fields `id`, `session_id`, `type`, `actor`, `ts`, `tool_use_id`. F1 covers the common `NAME=value` case without any of this risk. |
| F3 | Low | `redact.ts` | Other common tokens leak: `ghp_…`, `AKIA…`, `apikey=` in a URL query. A key split across stdout and stderr is only partly masked: the head is masked, the tail fragment (`d4E5f6G7h8I9j0` in the test) stays in `raw.tool_response.stderr`. Zero-width characters inside a key also leave a tail. | Add `ghp_/gho_/github_pat_`, `AKIA[0-9A-Z]{16}` and `[?&](api)?key=` rules. Strip zero-width characters before matching. Split-key fix: also redact the joined `output` string and drop `raw.tool_response` stdout/stderr duplicates, or accept as residual risk. |
| F4 | Low | `packages/capture/hook.ts` | Valid JSON that is not an object (`[1,2]`) exits 0 but prints nothing to stderr. The brief asks the hook to say so. Unmapped events (for example `Notification`) are also silent, which is fine. | Print `devlens hook: payload was not an object` when `handleHook` gets a non-object. |
| F5 | Low | `packages/cli/src/init.ts` | `SessionStart` is registered but the hook discards it. Each session spawns one Node and tsx process for no event. | Remove `SessionStart` from `HOOK_EVENTS`, or keep it deliberately and note why. |
| F6 | Info | `append-event.ts` | The same hook payload delivered twice appends two lines with the same `id`. Fuzz: 2 identical prompts gave 2 lines. Ids are idempotent by design, so ingest must dedupe by `id`. A missing `prompt_id` or `tool_use_id` gives an id ending `:unknown`, which would collide for two prompts. The probe saw `prompt_id` on every event, so this is unlikely. | Slice 2 ingest: dedupe by `id`. Optional: skip the append if the id already exists. |
| F7 | Info | `settings.local.json` | The installed command holds absolute paths to this machine's `node` and repo. Fine for a local, gitignored file. It breaks if the repo moves. | Re-run `devlens init` after a move. Document in the README. |

## Resulting `settings.local.json` (dir with user content)

The user `PreToolUse` Bash hook, `permissions`, `env` and `Notification` hook are kept. DevLens adds one group per event: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`. Each uses `command: <node path>` with `args: [<repo>/node_modules/tsx/dist/cli.mjs, <repo>/packages/capture/hook.ts]`. Full file: `/tmp/s3r/b/.claude/settings.local.json`.

## Verdict

**VERIFIED-WITH-GAPS**

Gaps (none block Slice 3 acceptance):

1. F1: add the `NAME=value` secret-line rule before real use with a candidate's machine.
2. F2 and F3: short env values and non-`sk-` tokens still leak. Residual risk is accepted only if F1 lands.
3. F4 and F5: small cleanups.
4. F6: ingest must dedupe by `id`.

The Accept line is met: a real `claude -p` run emitted session and tool-use ids, the fake `sk-` content is absent, missing fields stay null or unknown, and user-global Claude settings did not change.
