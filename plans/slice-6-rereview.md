# Slice 6 re-review — DevLens Agent core

Independent re-review of `packages/agent` and the `package.json` script diff. No product source was edited. No package was installed. No commit. `packages/agent/src/cli.ts` is absent and belongs to Slice 7. That absence is not a finding.

The spec is the Design section in `plans/review-questions-overnight.md`, including the "Revised again 2026-10-27" bullets, which win, and the Slice 6 Accept line. Contract rows: EVAL-24, REQ-25, NOT-7, NOT-8, NOT-10, DEC-15. The first review is `plans/slice-6-review.md` (FAIL).

`package.json` adds only `test:agent` and `agent:smoke`.

Secret-path probes ran from a read-only script under `/tmp` on this Mac (case-insensitive APFS). They called `readSafeFile`, `isSecretPath`, and `buildContext`. A second script called `runAtStop` with a fake engine.

## Earlier findings

| # | First review | Result |
|---|---|---|
| Major 1 | `.ENV` and `.SSH/id_rsa` were read | Closed. `isSecretPath` (`context.ts:20`) lowercases every segment. `.ENV` and `.env` are the same inode (`536491013`); `readSafeFile` returns null. `.SSH/id_rsa` and `CERT.PEM` are the same inodes as `.ssh/id_rsa` and `cert.pem`, and return null. `agent.test.ts:195` and `agent.test.ts:212` fail on the old check. |
| Major 2 | U+200B hid "score", then redaction restored it | Closed for that character. `normalize` (`validate.ts:14`) strips U+200B before the banned-word test, and `run.ts:68` stores `verdict.text`. `How would you sc\u200bore this approach?` is `dropped_banned_score`. `agent.test.ts:93` fails on the old order. A wider hole is Major 1 below. |
| Major 3 | Id was `agent_question` and actor was `agent` | Closed. Id is `<session_id>:devlens_question:<stop_event_id>`. Actor is `tool`. `agent.test.ts:71` and `agent.test.ts:73` fail on the old values. The smoke id matches the spec. |
| Minor 1 | `You could...` and a bare `verdict` were dropped | Closed for those sentences. `You could keep Postgres for this service; what constraint decided it?` is kept. `What verdict did the test report?` is kept. `agent.test.ts:106` keeps `Could you explain...`. A narrower false positive remains as Minor 3. |
| Minor 2 | A result line was written with no lock | Closed. `recordResult` (`ledger.ts:60`) returns without writing when `acquire` returns null. `agent.test.ts:163` fails on the old branch. |
| Minor 3 | Two overlapping runs both called the engine; a Stop that asked nothing was sent again | Closed. `reserveSlot` (`ledger.ts:47`) skips a `stop_event_id` already reserved, before the engine call. `agent.test.ts:119` expects one call and fails on the old race. A probe after `{"question":null}` got `already_run_at_this_stop` and did not call again. That second case is not in the suite. |
| Minor 4 | `realSpawner` never ran | Closed. `agent.test.ts:272` runs `realSpawner`. A shell metacharacter stays one argv entry. A 200 ms child is killed and the error is `timeout after 200 ms`. |

The per-Stop reservation matches the builder's extra claim. A probe reserved a slot and then crashed before `recordResult`. The next `runAtStop` for that Stop returned `already_run_at_this_stop` and made no engine call.

## Major

### 1. Default-ignorable characters still store a question that reads as a score or a fix

`validate.ts:13` strips U+00AD, U+034F, U+061C, U+180E, U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, and U+FEFF. `validate.ts:15` then applies NFKC. `validate.ts:39` tests the banned-word regex on that text. `validate.ts:41` returns it. `run.ts:57` redacts that same text. `run.ts:68` appends it.

NFKC does not remove variation selectors or the other default-ignorable characters below. They are not word characters, so they split `score` and `fix` and the regex does not match. The question is appended. In a browser those characters are invisible, so the question reads as the banned word.

Reproduced with `runAtStop` and a fake engine. Each reply cited a real event id. Each event was stored with `actor: "tool"` and id `sess:devlens_question:sess:Stop:p1`.

| Hidden character | Reply text | Stored |
|---|---|---|
| U+FE0E | `How would you scor\uFE0Ee this approach?` | kept, code point `fe0e` between `r` and `e` |
| U+FE0E | `Why not fi\uFE0Ex the empty cart?` | kept, code point `fe0e` between `i` and `x` |
| U+E0100 | `How would you scor\u{E0100}e this approach?` | kept |
| U+115F | `How would you sc\u115Fore this approach?` | kept |
| U+180B | `How would you sc\u180Bore this approach?` | kept |

`agent.test.ts:93` covers U+200B only. That test stays green.

Failure: event or file text tells the model to hide "score" or "fix" with U+FE0E. The question is appended. NOT-8, NOT-10, and the Accept line say that question is dropped.

## Minor

### 1. A hard link of a secret file is read

`readSafeFile` (`context.ts:67` and `context.ts:71`) rejects secret path strings and a `realpath` outside the project. It does not compare inodes. A hard link keeps the secret inode and a safe path.

Reproduced: `src/hard.envcopy` was a hard link to `.env` (same inode `536491013`). `readSafeFile` returned `TOKEN=real-secret`. `buildContext` put that text in `files`. The symlink `env-link.txt` to `.env`, the symlink `README.md` to `.env`, and `src/key-link` to `.ssh/id_rsa` all returned null.

Failure: the session runs `ln .env src/hard.envcopy` and edits `src/hard.envcopy`. The next Stop sends the `.env` body to the model. A symlink with the same name does not.

### 2. Secret-path matching does not apply NFKC

`isSecretPath` (`context.ts:20`) lowercases segments. It does not NFKC them. On this Mac a look-alike name is a different inode, and it does not open the real `.env`. `readSafeFile` still returns the look-alike file's body:

| Name | NFKC | `isSecretPath` raw | Body read | Same inode as `.env` |
|---|---|---|---|---|
| `.ｅｎｖ` (fullwidth letters) | `.env` | false | yes | no |
| `．env` (U+FF0E) | `.env` | false | yes | no |
| `cert.ｐｅｍ` | `cert.pem` | false | yes | no |

After those files were removed, the same requests returned null. Cyrillic `.еnv` and `.ѕsh/id_rsa` do not NFKC to the secret spellings. They were read as their own files.

Failure: a touched file named `.ｅｎｖ` or `cert.ｐｅｍ` is sent to the model. The real `.env` is not opened by that spelling.

### 3. `try` plus a one-letter word is dropped as a fix

`validate.ts:9` includes `try\s+(to\s+)?\w`. `\w` is one character, and the final `\b` needs a boundary immediately after it.

Reproduced: `Why did you try a retry here?` is `dropped_banned_fix`. `Why did you try to return an empty list?` is kept, because the boundary falls inside `return`.

Failure: a reply that asks why the developer tried a one-letter word is dropped, and nothing is asked. The Accept line still holds for the four named classes.

## Checked, not findings

- CLI argv is `-p`, `--model claude-sonnet-5-5`, `--tools` `""`, `--system-prompt`, `--output-format json`, `--permission-prompts none`, `--strict-mcp-config`, `--setting-sources project`, `--disable-slash-commands`, `--no-session-persistence`. No `--bare`, `--allowedTools`, `--fallback-model`, or `--add-dir`. Temp cwd is empty. `DEVLENS_AGENT=1`. Stdin is the user prompt. `realSpawner` uses `execFile`.
- Opt-in is on only when `enabled === true`. Missing, unreadable, invalid, and `{"enabled":false}` make no call and write no ledger line.
- A blank or whitespace `ANTHROPIC_API_KEY` selects the CLI. A non-blank key selects the API. The API test uses a local HTTP server, sends no `tools` field, and does not retry.
- Budget: a `reserved` line with `session_id` and `stop_event_id` is written under the `wx` lock before the call. The cap is 30 reserved lines. The result line has time, route, model, duration, and ok or error. The prompt is not in the ledger.
- Timeout is 60 seconds. A thrown engine error or a failed result asks nothing, is not retried, and does not switch route or model.
- Unknown cites, non-JSON, empty cites, and plain score, rank, hire, and fix text are dropped. The system prompt says event and file text are data.
- Symlinks to a secret inside the project, to `~`-style `.ssh` outside the project, and to a file outside the project return null. An absolute path outside the project returns null. `src/../.ENV` returns null.
- Stale ledger lock: 25 pairs called `acquire` together on a lock whose mtime was 1000 seconds old. Both entered. Their critical sections did not overlap (0 of 25). A crash that leaves a fresh lock is left for the 120 second stale window; `acquire` then returns null after about 2.5 seconds, and `recordResult` writes nothing.
- `packages/link/src/rules.ts:15` does not treat `type: 'question'` as a tool event. Actor `tool` on a question does not add a link edge.
- Cyrillic `о` (U+043E) in `scоre` is kept. NFKC does not fold it to Latin. It is a different letter, not an invisible character.

## Commands

`npm run -s check && npm run -s test:agent` exited 0. `tsc --noEmit` printed nothing. Vitest tail:

```
 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens

 Test Files  1 passed (1)
      Tests  40 passed (40)
   Start at  22:40:00
   Duration  4.66s (tests 99%, import 1%)
```

`npm run -s agent:smoke` exited 0. One real `claude -p` call. Output:

```
engine route: claude_cli, model: claude-sonnet-5-5 (synthetic fixture session)
KEPT question: {
  "id": "synthetic-session-1:devlens_question:synthetic-session-1:Stop:p1",
  "text": "The diff both defaults the reduce to 0 and adds an early `return []` for empty items. Why include both, and was the empty-list return meant to sit in the same function as the total calculation?",
  "cites": [
    "synthetic-session-1:tu2:post"
  ],
  "reason": "cites 1 real session event"
}
ledger lines:
{"ts":"2026-10-28T03:41:37.761Z","kind":"reserved","session_id":"synthetic-session-1","stop_event_id":"synthetic-session-1:Stop:p1"}
{"ts":"2026-10-28T03:41:37.761Z","kind":"result","session_id":"synthetic-session-1","route":"claude_cli","model":"claude-sonnet-5-5","duration_ms":3411,"ok":true}
```

Verdict: FAIL
