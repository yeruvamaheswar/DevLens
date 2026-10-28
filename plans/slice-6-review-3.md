# Slice 6 third review — DevLens Agent core

Independent review of `packages/agent` and the `package.json` script diff. No product source was edited. No package was installed. No commit. `packages/agent/src/cli.ts` is absent and belongs to Slice 7. That absence is not a finding.

The spec is the Design section in `plans/review-questions-overnight.md`. The "Revised again 2026-10-27" bullets win. The Slice 6 Accept line is the pass bar. Contract rows: EVAL-24, REQ-25, NOT-7, NOT-8, NOT-10, DEC-15. Earlier reviews: `plans/slice-6-review.md` (FAIL) and `plans/slice-6-rereview.md` (FAIL). The Risks section accepts one residual: look-alike letters from other scripts in the NOT-8 word filter.

`package.json` adds only `test:agent` and `agent:smoke`.

Probes ran from read-only scripts under `/tmp` on this Mac (case-insensitive APFS). They called `runAtStop` with a fake engine, `validateReply` with the same redact clean path `run.ts` uses, `readSafeFile`, `isSecretPath`, and `buildContext`. A sweep covered every code point in `\p{Default_Ignorable_Code_Point}`, `\p{Cf}`, and `\p{Cc}` except newline and tab.

## Earlier findings

| # | Earlier review | Result |
|---|---|---|
| Re-review major 1 | U+FE0E, U+E0100, U+115F, and U+180B stored a question that reads as "score" or "fix" | Closed. `normalize` (`validate.ts:17`) applies NFKC, then removes `\p{Default_Ignorable_Code_Point}` and `\p{Cf}`. Each of those four replies is `dropped_banned_score` or `dropped_banned_fix`. The event file has no question. The same holds for U+00AD, U+2060, U+200B–U+200F, U+FEFF, U+034F, U+061C, U+180C–U+180E, U+2061–U+2066, U+206A, U+202A, U+202E, U+FE00, U+FE0F, U+1160, U+3164, U+FFA0, U+17B4, U+17B5, U+FFF9, U+FFFB, U+E0001, U+E0020, U+1D173, and U+1BCA0. The sweep kept none of them. A control other than newline or tab, including CR, NUL, ESC, BEL, DEL, NEL, VT, FF, and backspace, is `dropped_control_character`. |
| Re-review minor 1 | A hard link to `.env` was read | Closed. `readSafeFile` (`context.ts:76`) returns null when `nlink > 1`. `src/hard.envcopy` and `src/hard.key` return null. `buildContext` does not contain `TOKEN=real-secret`. `src/a.ts` (`nlink` 1) is still read. |
| Re-review minor 2 | No NFKC on secret paths | Closed for the stated failure. `isSecretPath` (`context.ts:22`) normalizes, then lowercases. Fullwidth `.ｅｎｖ`, `．env`, `cert.ｐｅｍ`, and `.e\u200bnv` are secret and `readSafeFile` returns null. Cyrillic `.еnv` remains minor 3. |
| Re-review minor 3 | `Why did you try a retry here?` was dropped | Closed. `runAtStop` keeps it. `Why did you try to return an empty list?` is kept. `Try adding` and `try switching` are `dropped_banned_fix`. |
| First major 1 | `.ENV` and `.SSH/id_rsa` read the real secret | Closed. `.ENV` and `.env` are inode `536602983`. `readSafeFile` returns null for `.ENV`, `.SSH/id_rsa`, `CERT.PEM`, and `src/../.ENV`. |
| First major 2 | U+200B hid "score", then redaction restored it | Closed. The reply is `dropped_banned_score` and nothing is stored. The kept text is `verdict.text` after normalize and `redactString` (`run.ts:57`, `run.ts:68`). |
| First major 3 | Id was `agent_question` and actor was `agent` | Closed. Id is `sess:devlens_question:sess:Stop:p1`. Actor is `tool`. Source, provenance, null media fields, and payload keys `text`, `cites`, `reason`, `stop_event_id`, `route`, `model` match the winning bullet. |
| First minor 2 | A result line was written with no lock | Closed. A fresh ledger lock makes `recordResult` (`ledger.ts:60`) return without creating the ledger file. A lock whose mtime is 1000 seconds old can be taken. |
| First minor 3 | Two overlapping runs both called the engine; a Stop that asked nothing was sent again | Closed. Two overlapping `runAtStop` calls make one engine call and append one question. After `{"question":null}`, the next call is `already_run_at_this_stop` and does not call the engine. |
| First minor 4 | `realSpawner` never ran | Closed. `engines.ts:24` uses `execFile` with `SIGKILL` and no shell. `agent.test.ts:317` runs `realSpawner`, and that test is in the 57 that passed. |

## Minor

### 1. Look-alike letters from another script still spell a banned word

Accepted residual (Tech Lead, 2026-10-27, Risks). `normalize` (`validate.ts:17`) does not fold Cyrillic or Greek to Latin. The banned patterns (`validate.ts:6`) then see no match.

Reproduced with `runAtStop`. The reply `How would you sc\u043ere this approach?` (Cyrillic `о`, U+043E) is stored with that code point between `c` and `r`. Greek omicron (`sc\u03bFre`) is kept by `validateReply`. In a typical font the question reads as "score".

NFKC folds are caught: mathematical bold "score", fullwidth "score", U+017F + "core", and the ligature "ﬁx" are dropped.

Failure: event text tells the model to hide "score" with Cyrillic `о`. The question is appended. The Risks section already accepts this until the agent is on by default.

### 2. A default-ignorable character inside `.env.example` is treated as the allowlist exception

`isSecretPath` (`context.ts:22`) runs `normalize` before the exception check at `context.ts:25`. Stripping a default-ignorable character turns a `.env*` basename into the exact string `.env.example`, so the function returns false. `readSafeFile` (`context.ts:69`) then reads the file. The inode is not `.env`.

Reproduced:

| Name | `isSecretPath` | Body returned | Same inode as `.env` |
|---|---|---|---|
| `.env.ex\u200bample` | false | `EXZW-SECRET` | no |
| `.env.example\u200b` | false | `EXTRAIL` | no |
| `.env.exam\uFE0Eple` | false | `FE0E-SECRET` | no |

`buildContext` put the U+200B name in `files`. U+FE0E is invisible, so that name renders as `.env.example`. The real `.env.example` is a different inode and is still readable, which the spec allows. `.e\u200bnv` and `.env\u200b` stay secret and return null.

Failure: the session edits `.env.exam\uFE0Eple` and puts a token in it. The next Stop sends that body to the model. NOT-10 says `.env*` is never read, except the exact name `.env.example`.

### 3. A Cyrillic look-alike of `.env` is read as its own file

`isSecretPath` (`context.ts:22`) lowercases the NFKC form. Cyrillic `е` (U+0435) does not become `e`. `readSafeFile` on `.\u0435nv` returns `CYRILLIC-FILE`. The inode is not `.env`. `buildContext` included that body.

Failure: a touched file named `.еnv` is sent to the model. This is the same look-alike class as minor 1, applied to a path. It is not a regression of the fullwidth fix.

## Checked, not findings

- These legitimate replies are kept, and the stored text keeps the meaningful characters: normal punctuation including the em dash; `café`; backticks around `items.reduce(...)`; 👍 and 👎; an interior tab and an interior newline. U+2026 becomes three ASCII dots under NFKC. U+FE0F is stripped from ❤️ and U+200D is stripped from a family emoji; the question is still kept and the emoji characters remain. `fixture`, `prefix`, and `upgrade` are kept.
- U+00A0 inside "score" becomes a normal space under NFKC. The stored text is `scor e`. The letters do not join.
- U+2800 (braille blank), U+2028, and U+2029 are kept inside "score". They are not Default_Ignorable or Cf. U+2028 and U+2029 are line breaks. U+2800 is a braille cell, so the letters are not zero-width-adjacent. Noncharacters U+FFFE, U+FFFF, and U+FDD0 are also kept. They are outside the strip set named in Risks.
- A lone surrogate U+D800 inside "score" is stored (`72,d800,65` in the question text). The regex does not see "score". A lone surrogate is not a Unicode scalar value. This review did not render it, so it is not ranked as the closed major.
- Symlinks to `.env`, to a file outside the project, and an absolute outside path return null. `.env.example` is read.
- CLI argv matches the Design list, including `--tools` with an empty argument. No `--bare`, `--allowedTools`, `--fallback-model`, or `--add-dir`. `selectEngine` uses the CLI for a missing, empty, or blank key, and the API for a non-blank key. The API engine sends `max_tokens: 4096` and no `tools` field (`engines.ts:75`).
- Opt-in, the 30-call cap, the 60-second timeout, and the system-prompt rule that event and file text are data remain as in the re-review. `packages/link/src/rules.ts:15` still limits tool types to `tool_call`, `file_edit`, and `test`.

## Commands

`npm run -s check && npm run -s test:agent` exited 0. `tsc --noEmit` printed nothing. Stderr printed a Node warning that `NO_COLOR` is ignored because `FORCE_COLOR` is set. Vitest tail:

```
 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens

 ✓ packages/agent/tests/agent.test.ts (57 tests) 4923ms
   ✓ errors and budget (5)
     ✓ writes no result line and no reservation when the ledger lock is held 3242ms
     ✓ stops at 30 calls per session and leaves the lock file clean 534ms

 Test Files  1 passed (1)
      Tests  57 passed (57)
   Start at  23:00:11
   Duration  5.26s (tests 97%, transform 2%, import 1%)
```

`npm run -s agent:smoke` exited 0. One real `claude -p` call. The same stderr warning appeared. Stdout:

```
engine route: claude_cli, model: claude-sonnet-5-5 (synthetic fixture session)
KEPT question: {
  "id": "synthetic-session-1:devlens_question:synthetic-session-1:Stop:p1",
  "text": "In the edit you added both a zero-total guard and an early `return []` for empty items. Why did you choose to handle the empty cart in both places rather than just one?",
  "cites": [
    "synthetic-session-1:tu2:post"
  ],
  "reason": "cites 1 real session event"
}
ledger lines:
{"ts":"2026-10-28T04:03:30.569Z","kind":"reserved","session_id":"synthetic-session-1","stop_event_id":"synthetic-session-1:Stop:p1"}
{"ts":"2026-10-28T04:03:30.569Z","kind":"result","session_id":"synthetic-session-1","route":"claude_cli","model":"claude-sonnet-5-5","duration_ms":3293,"ok":true}
```

Verdict: PASS
