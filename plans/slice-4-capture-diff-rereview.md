# Slice 4 re-review: Multi-line capture diff

Independent re-review of the uncommitted diff in `packages/capture/map-hook.ts`, `packages/capture/handle.ts`, and `packages/capture/capture.test.ts`. The builder's claim was checked against that diff, the tightened Accept line in `plans/review-questions-overnight.md`, and the first review in `plans/slice-4-capture-diff-review.md`. Probes imported `handleHook`, `mapHook`, and `redactValue`. No other repo file was edited.

## Accept

`hunk` in `packages/capture/map-hook.ts:69` signs every line and strips one trailing `\n` before the split. `handleHook` in `packages/capture/handle.ts:45` redacts the masked input, then calls `mapHook`, then redacts the mapped event again (`handle.ts:48`).

The new tests lock the shapes the Accept line names:

- `capture.test.ts:201` expects `-one\n-two\n+x\n+y\n+z`.
- The same test locks one `MultiEdit` hunk and a `Write` of `content`.
- `capture.test.ts:213` expects `-o\n+p\n+q` for a trailing newline.
- `capture.test.ts:216` sends an `Edit` through `handleHook` with `SUPABASE_SECRET_KEY` set to `multiline-secret-AAAA\nmultiline-secret-BBBB`.

That secret test fails on the old order. Mapping first, then redacting, stores this diff:

```text
-x
+k = multiline-secret-AAAA
+multiline-secret-BBBB
+rest
```

`events.jsonl` then contains `multiline-secret-AAAA` and `multiline-secret-BBBB`, so both `not.toContain` assertions fail. With the new order the stored diff is `-x\n+k = [REDACTED]\n+rest`.

## What the probes showed

| Case | Stored result |
|---|---|
| Long secret `line1\nline2` in `Edit.new_string`, `Edit.old_string`, `MultiEdit` edits, and `Write.content` | Diff and raw contain `[REDACTED]`. Neither fragment is in the events file. `tool_name`, `files`, and id stay `Edit` / `MultiEdit` / `Write`, `src/app.ts`, `ses_1:t9:post`. |
| Short secret `abc123` (`MY_API_KEY`, 6 chars) on one line in those three tools | `payload.diff` is `[REDACTED]`. `raw` still holds `abc123`, which matches the free-text-only rule in `redact.ts:8`. |
| Short secret `ab\ncd` (`MY_API_KEY`, 5 chars) in `old_string` and `new_string` | Diff is `-ab\n-cd\n+k = ab\n+cd\n+rest`. See major finding. |
| Normal long secret beside `npm test`, file path `lib.mjs`, id `toolu_2` | Type stays `file_edit` or `test`. Path, id, command `npm test`, and status `passed` stay. Phase stays `pre`, `post`, or `failure` on non-test hooks. |
| `MY_API_KEY=test` and command `npm test` | Type becomes `tool_call`. The old order stored type `test`, status `passed`, command `npm [REDACTED]`. See major finding. |
| `MY_PASSWORD=pass` and stdout `ℹ pass 1` | Type stays `test`. Status becomes `unknown`. The old order stored `passed`. |
| `MY_TOKEN=pytest` / `vitest`, or `MY_SECRET=npm test` | Type becomes `tool_call`. The old order stored `test`. |
| Secret split across stdout and stderr (`sk-abcdEFGH` + `d4E5f6G7h8I9j0`) | Output is `key [REDACTED]\n[REDACTED] end`. Type stays `test`. |
| Secret equal to `stdout + "\n" + stderr` | The joined `output` is `[REDACTED]` on the second pass. |
| CRLF `one\r\ntwo` / `x\r\ny\r\nz` | `-one\r\n-two\n+x\r\n+y\r\n+z`. A trailing CRLF stores `-one\r\n-two\r\n+x\r\n+y\r` with no empty signed line. |
| Single line `a` / `b`, with or without a trailing `\n` | `-a\n+b`. |
| Trailing newline on `Write` and `MultiEdit` | `+p\n+q` and `-o\n+p\n+q`. |
| A real blank line, `p\n\nq\n` | `+p\n+\n+q`. That empty segment is the blank line. |
| Cap | A diff of length 4000 is kept. Length 4001 is dropped (`map-hook.ts:91`). |

`maskSplitStreams` still runs before either redaction (`handle.ts:45`). The existing split-secret test passed inside `test:capture`.

## Findings

### Major — a short secret that contains a newline survives in `payload.diff`

`packages/capture/handle.ts:45`, `packages/capture/redact.ts:80`, `packages/capture/map-hook.ts:69`.

`shortSecretValuesFromEnv` (`redact.ts:49`) returns env values of length 4 to 7 whose names look secret. `redactString` applies those values only when the field is free text (`redact.ts:80`). `old_string`, `new_string`, and `content` are not in `FREE_TEXT_KEYS` (`redact.ts:8`). `diff` is.

The first pass therefore leaves `ab\ncd` intact in the edit text. `hunk` then writes `-ab\n-cd` and `+k = ab\n+cd`. The second pass looks for the contiguous string `ab\ncd` in `diff` and does not find it.

Failure: `MY_API_KEY` is `ab\ncd`. An `Edit`, `MultiEdit`, or `Write` includes that value in `old_string`, `new_string`, or `content`. The events file stores `"-ab\\n-cd\\n+k = ab\\n+cd\\n+rest"`. Replay drops `payload.raw` (`apps/web/replay/view.ts:128`) and draws `payload.diff` (`apps/web/replay/page.tsx:157`), so the replay hook diff shows both lines. The same input under the old `- old\n+ new` hunk kept `ab\ncd` contiguous inside `diff`, and the free-text pass replaced it.

A one-line short secret is still removed from `diff` (`+token [REDACTED]`, `-a\n+use [REDACTED]`). The new test uses a long secret and only `Edit`, so this stays green.

### Major — redacting the whole input before mapping changes test type and status

`packages/capture/handle.ts:45`, `packages/capture/map-hook.ts:209`.

`command`, `stdout`, `stderr`, and `error` are free text, so the first pass rewrites them before `isTestCommand` and `testStatusFromOutput`. A normal secret left inside a longer command does not do this: `npm test --token=supabase-fake-value-xyz` stays a passing test, with the token replaced.

Failure: the env contains `MY_API_KEY=test`. The developer runs `npm test` and the summary is `ℹ pass 1` / `ℹ fail 0`. The stored event is `type: tool_call`, `phase: post`, with no status. The old order stored `type: test`, `status: passed`, and `command: npm [REDACTED]`. The same flip happens for `MY_TOKEN=pytest` (`pytest tests/foo.py`), `MY_TOKEN=vitest` (`npx vitest`), and `MY_SECRET=npm test`.

A second failure on the same line: `MY_PASSWORD=pass` rewrites `ℹ pass 1` to `ℹ [REDACTED] 1` before the status parse. The event stays `type: test` and the status becomes `unknown`. The old order stored `passed` and redacted the output afterward.

`tool_name`, file paths, ids, and phase stay on inputs whose secret is a normal token. The damage is the test command and the test summary, which this order reads only after redaction.

### Minor — a line whose text starts with `++` is dropped from follow-up

`packages/capture/map-hook.ts:69`, `packages/questions/src/adapter.ts:41`. Unchanged since the first review.

Failure: `new_string` is `+kept\n++dropped`. The diff is `-a\n++kept\n+++dropped`. Follow-up keeps `+kept` and drops `dropped`. Replay paints `+++dropped` as diff metadata (`apps/web/replay/page.tsx:66`).

### Minor — the secret test covers only `Edit`

`packages/capture/capture.test.ts:220`.

Failure: a later change redacts `tool_input.new_string` and skips `edits[].new_string` or `content`. The new test stays green. A probe of the current tree does redact those fields for a long secret. This is a gap in the test, and the current three tools hold the long-secret line.

## Commands

`NO_COLOR=1` and `FORCE_COLOR=0` were both set. The hook CLI assertions passed in that environment, so they were left set.

`npm run -s check && npm run -s test:capture && npm run -s fixture:verify -- broken-api && npm run -s test:questions` exited 0. `check` printed nothing. Tail:

```text
 Test Files  1 passed (1)
      Tests  19 passed (19)
   Start at  22:22:13
   Duration  898ms (tests 97%, import 2%, transform 1%)

PASS

 Test Files  6 passed (6)
      Tests  91 passed (91)
   Start at  22:22:15
   Duration  524ms (tests 80%, import 9%, transform 8%, worker 3%)
```

`fixture:verify` printed `PASS` between those two Vitest runs.

Verdict: FAIL
