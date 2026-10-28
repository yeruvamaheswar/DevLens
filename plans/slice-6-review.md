# Slice 6 review — DevLens Agent core

Independent review of `packages/agent` and the `package.json` script diff. No product source was edited. No package was installed. No commit.

The spec is the Design bullets in `plans/review-questions-overnight.md` after "Revised 2026-10-27", including the "Revised again" bullets that win over earlier bullets, and the Slice 6 Accept line. `plans/agent-design-review.md` is why those rules exist. `plans/devlens.contract.md` rows EVAL-24, REQ-25, NOT-7, NOT-8, NOT-10, and DEC-15 match that Design.

`package.json` adds only `test:agent` and `agent:smoke`.

## Major

### 1. A case-variant path reads a secret file inside the project

`packages/agent/src/context.ts:20` treats `.ssh` as secret only when that exact segment appears. `context.ts:22` treats `.env*` as secret only when the basename starts with the lowercase prefix `.env`. `*.pem` and `*.key` are lowercased (`context.ts:23`). `readSafeFile` (`context.ts:67` and `context.ts:71`) uses that check on the requested path and again on the path `realpath` returns. `buildContext` (`context.ts:97`) reads every touched `file_edit` or `test` path through `readSafeFile`.

On this Mac the volume is case-insensitive. `realpath` of `.ENV` keeps the requested spelling `.ENV` even when the directory entry is `.env`. Reproduced against `readSafeFile` and `buildContext`:

- A file stored as `.env` with `TOKEN=real` is returned for the request `.ENV`. The request `.env` is rejected.
- A touched-file list `.ENV.local` and `.SSH/id_rsa` loads `DATABASE_URL=postgres://user:s3cret@host/db` and `PRIVATE KEY`.
- A symlink to a file outside the project, and a symlink to `.env` under another name, still return null. An absolute path outside the project still fails the `realpath` check.

`redactString` does not cover `DATABASE_URL` or a PEM body. Those strings go into the user prompt. The walk does not list a directory entry whose real name is `.env` or `.ssh`, so the hole is the touched path, which is whatever the coding agent put in the event.

Failure: Claude Code records a Read or Edit of `.ENV` or `.SSH/id_rsa`. The next Stop sends that file to the model. NOT-10 and the Context bullet say those files are never read. `packages/agent/tests/agent.test.ts:166` only uses lowercase names, so the suite stays green.

### 2. Redaction puts a banned word back into a question the validator accepted

`validateReply` (`packages/agent/src/validate.ts:30`) tests the trimmed model text. `runAtStop` (`packages/agent/src/run.ts:60`) then runs `redactString` on the accepted text. `redactString` (`packages/capture/redact.ts:58`) deletes zero-width characters before it returns.

Reproduced: the reply `How would you sc\u200bore this approach?` with a real event id is `ok: true`. After `redactString` the stored text is `How would you score this approach?` and matches `\bscore\b`.

Failure: event or file text tells the model to hide "score", "rank", "hire", or "fix" with U+200B. The question is appended. NOT-8 and NOT-10 say that question is dropped. The plain-word tests in `agent.test.ts:89` do not cover this order.

### 3. The stored question does not match the winning event mapping

`plans/review-questions-overnight.md:86` says the id is `<session_id>:devlens_question:<stop_event_id>` and the actor is `tool`, because `agent` means the coding agent. `run.ts:33` writes `<session_id>:agent_question:<stop_event_id>`. `run.ts:63` sets `actor: 'agent'`. The other stored fields match that bullet: type, source, provenance, null media fields, and payload `{ text, cites, reason, stop_event_id, route, model }`.

`packages/agent/tests/agent.test.ts:70` expects the `agent_question` id and does not read `actor`. The smoke run printed `synthetic-session-1:agent_question:synthetic-session-1:Stop:p1`.

Failure: Slice 7, or any reader of that bullet, looks up `<session>:devlens_question:<stop>` and finds no question. The same Stop can be asked again by a writer that uses the spec id, because the repeat check at `run.ts:34` looks for the other id. `packages/link/src/rules.ts:15` does not treat `type: 'question'` as a tool event, so this actor does not draw a false link edge today. The stored actor is still the one the spec says not to use.

## Minor

### 1. The banned list drops questions that do not name a score, rank, hire verdict, or fix

`packages/agent/src/validate.ts:4` also rejects `verdict` alone, `you could`, `you should`, `consider using`, and `i recommend`. Failure: a reply `You could keep Postgres for this service; what constraint decided it?` is `dropped_banned_fix` and nothing is asked. The builder's note is true. The Accept line still holds for the four named classes.

### 2. A result line is appended when the ledger lock is not acquired

`packages/agent/src/ledger.ts:57` writes the result line when `acquire` returns null after 100 failed attempts. Two writers can then append at the same time. `reserveSlot` does not have this branch: a missed lock skips the call. Failure: a stuck lock for 2.5 seconds, then a result line is written beside another writer's line.

### 3. The same-Stop check is not atomic with the append

`run.ts:34` reads events before the call. `appendEvent` locks only the write. Failure: two overlapping `runAtStop` calls for one `stop_event_id` both miss the id, both call the model, and both append. If the texts differ, `dedupeEvents` later throws on that id. A second call after the first has returned is skipped. The builder's note is true only for that later call, and only when the first call kept a question. A Stop that asked nothing is sent to the engine again. That second call still counts toward the 30-call cap.

### 4. `realSpawner` never runs in the suite

`packages/agent/src/engines.ts:22` uses `execFile` with no shell, `SIGKILL`, and the temp directory. `agent.test.ts:218` replaces the spawner. The argv, empty cwd, `DEVLENS_AGENT=1`, stdin, and timeout are asserted on that seam. Failure: a change from `execFile` to a shell `exec` stays green. Inspection of `realSpawner` shows `execFile` and no `shell` option today.

## Builder notes

| Note | Result |
|---|---|
| User prompt goes to `claude -p` on stdin | True. `engines.ts:31` ends stdin with the user text. `-p` has no prompt argument. |
| Question id is `<session>:agent_question:<stop_event_id>`, and a repeat at that Stop is skipped | The id matches the code and the smoke output. It does not match the winning spec id. A repeat is skipped only after a question with that id was kept. |
| Banned-word matching may drop innocent questions | True. Minor 1. |
| The parser tolerates one ` ```json ` fence | True when the whole trimmed reply is one fence (`validate.ts:15`). Text around the fence is `dropped_not_json`. No test covers the fence. |
| API engine sends `max_tokens` 4096 and no tools or retries | True. `engines.ts:71` sends one POST with `max_tokens: 4096` and no `tools` field. The local-server test does not assert `max_tokens`. |

## Checked, not findings

- CLI argv is `-p`, `--model claude-sonnet-5-5`, `--tools` `""`, `--system-prompt`, `--output-format json`, `--permission-prompts none`, `--strict-mcp-config`, `--setting-sources project`, `--disable-slash-commands`, `--no-session-persistence`. No `--bare`, `--allowedTools`, `--fallback-model`, or `--add-dir`.
- Temp cwd is created empty and removed in `finally`. The child env sets `DEVLENS_AGENT=1`.
- Opt-in off (missing, unreadable, invalid, or `enabled` not `true`) returns before a call and writes no ledger line.
- A `reserved` line with `session_id` is appended under a `wx` lock before the call. The cap is 30 reserved lines per session. The lock file is stale after 120 seconds. The result line has time, route, model, duration, and ok or error. The prompt is not written there.
- Timeout is 60 seconds. A failed call asks nothing, is not retried, and does not switch route or model. A thrown engine error becomes one failed result.
- A blank or whitespace `ANTHROPIC_API_KEY` selects the CLI. A non-blank key selects the API.
- Unknown cite, non-JSON, empty cites, and plain score, rank, hire, and fix text are dropped. The schema accepts one question object.
- The user prompt and the kept text go through `redactString`. The system prompt says event and file text are data, not instructions. Repo file reads that stay inside the project `realpath` are limited to 8 files and the stated byte caps. The walk skips dot-directories, `node_modules`, and secret basenames in their real spelling.
- The API test uses a real local HTTP server, not a mocked `fetch`.

## Commands

`npm run -s check && npm run -s test:agent` exited 0. `tsc --noEmit` printed nothing. Vitest tail:

```
 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens

 ✓ packages/agent/tests/agent.test.ts (32 tests) 934ms
   ✓ errors and budget (4)
     ✓ stops at 30 calls per session and leaves the lock file clean 319ms

 Test Files  1 passed (1)
      Tests  32 passed (32)
   Start at  22:24:53
   Duration  1.19s (tests 86%, import 9%, transform 5%)
```

`npm run -s agent:smoke` exited 0. One real `claude -p` call. Output:

```
engine route: claude_cli, model: claude-sonnet-5-5 (synthetic fixture session)
KEPT question: {
  "id": "synthetic-session-1:agent_question:synthetic-session-1:Stop:p1",
  "text": "In the edit, the empty-cart case got both a 0 initial value for reduce and an early `return []`. Why did you choose to cover it both ways, and how did you decide the endpoint should return a list there?",
  "cites": [
    "synthetic-session-1:tu2:post"
  ],
  "reason": "cites 1 real session event"
}
ledger lines:
{"ts":"2026-10-28T03:25:00.505Z","kind":"reserved","session_id":"synthetic-session-1"}
{"ts":"2026-10-28T03:25:00.505Z","kind":"result","session_id":"synthetic-session-1","route":"claude_cli","model":"claude-sonnet-5-5","duration_ms":3265,"ok":true}
```

Verdict: FAIL
