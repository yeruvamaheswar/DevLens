# Slice 4 review 3: Multi-line capture diff

Independent review of the uncommitted diff in `packages/capture/map-hook.ts`, `packages/capture/handle.ts`, and `packages/capture/capture.test.ts`. The builder's claim was checked against that diff, the Accept line in `plans/review-questions-overnight.md`, `plans/slice-4-capture-diff-review.md`, and `plans/slice-4-capture-diff-rereview.md`. A read-only probe under `/tmp` imported `handleHook`, `mapHook`, `redactValue`, `secretValuesFromEnv`, and `shortSecretValuesFromEnv`. No other repo file was edited.

## Accept

`hunk` in `packages/capture/map-hook.ts:69` signs every line and strips one trailing `\n` before the split. The 4000-character cap is unchanged at `packages/capture/map-hook.ts:91`.

`handleHook` in `packages/capture/handle.ts:65` still runs `maskSplitStreams`, then `redactEditText`, then `mapHook`, then `redactValue` of the mapped event (`packages/capture/handle.ts:68`). `redactEditText` (`packages/capture/handle.ts:50`) copies `tool_input` and each `edits` item and runs `redactString` on `old_string`, `new_string`, `oldString`, `newString`, and `content`, with both long secrets and short secrets (`packages/capture/handle.ts:43`). It leaves `command`, `stdout`, `stderr`, and `error` for classification.

The new tests lock the shapes the Accept line names:

- `packages/capture/capture.test.ts:201` expects `-one\n-two\n+x\n+y\n+z`.
- The same test locks one `MultiEdit` hunk, a `Write` of `content`, and a 4000-character `new_string` that drops `payload.diff`.
- `packages/capture/capture.test.ts:213` expects `-o\n+p\n+q` for a trailing newline.
- `packages/capture/capture.test.ts:216` sends a long two-line secret through `handleHook` and checks the events file.
- `packages/capture/capture.test.ts:249` expects type `test` and status `passed` when `MY_API_KEY` is `test` and when `MY_PASSWORD` is `pass`.

## The odd result

The second review's major 1 was right. The new test does not reproduce it. The later pass over `diff` does not catch a secret that contains a newline.

`packages/capture/capture.test.ts:233` sets `MY_API_KEY` to `ab12\ncd34`. That value has length 9. `secretValuesFromEnv` (`packages/capture/redact.ts:45`) keeps values of length 8 or more. `shortSecretValuesFromEnv` (`packages/capture/redact.ts:49`) keeps lengths 4 to 7. The probe put this value only in the long list.

On the second review's order (whole-input `redactValue`, then `mapHook`, then `redactValue`), the builder assertions pass. Long secrets are replaced in every string, including `new_string`, before `hunk` runs. The stored diff is:

```text
-x
+k=[REDACTED]
```

`ab12` and `cd34` are already gone, so `packages/capture/capture.test.ts:244` stays green on the code that leaked a short secret.

On map-then-redact, the same input stores:

```text
-x
+k=ab12
+cd34
```

`diff` does not contain the contiguous string `ab12\ncd34`. The second pass leaves both fragments. A one-line short secret still disappears there: `abc123` in `k=abc123` becomes `+k=[REDACTED]`, because the signed line still contains that secret as one token. That is the case the later pass catches. It is a different case.

The second review's input, `MY_API_KEY=ab\ncd` (length 5), still leaks on both old orders:

```text
-ab
-cd
+k = ab
+cd
+rest
```

## What the probe showed

| Case | Stored result |
|---|---|
| Current `handleHook`, secret `ab\ncd` in `Edit` `old_string` / `new_string` | `-[REDACTED]\n+k = [REDACTED]\n+rest`. The events file has neither fragment. `tool_name` `Edit`, files `src/app.ts`, id `ses_1:s1:post`, type `file_edit`. |
| Same secret on camelCase `oldString` / `newString` | Same redacted diff. |
| Same secret in `MultiEdit` `edits[]` and in `Write` `content` | `-[REDACTED]\n+k = [REDACTED]\n+rest` and `+v=[REDACTED]`. Ids `ses_1:s3:post` and `ses_1:s4:post`. |
| Short secret of length 7, `ab12\ncd` | `-x\n+k=[REDACTED]`. Fragments absent from the event and the file. |
| `MY_API_KEY=test`, `MY_PASSWORD=pass`, `MY_TOKEN=pytest`, `MY_TOKEN=vitest`, `MY_SECRET=npm test` | Current event matches map-then-redact: type `test`, status `passed` or `unknown` for empty vitest output, command and stdout redacted only after classification. Whole-input redaction still flips the `test` / `pytest` / `vitest` / `npm test` cases to `tool_call`, and flips `pass` to status `unknown`. |
| `PreToolUse` and `PostToolUseFailure` with those short secrets | Phase stays `pre` and `failure`. Ids and `tool_name` stay. |
| Plain multi-line edit, no secret | Diff `-one\n-two\n+x\n+y\n+z`, file `lib.mjs`, id `ses_1:toolu_2:post`, type `file_edit`. Same as map-then-redact. |
| Short secret `ab\ncd` split as stdout `key ab\n` and stderr `cd end` | Output `key [REDACTED]\n[REDACTED] end`. Type stays `test`. The events file does not contain the secret. |
| `xab\ncdy` with secret `ab\ncd` | Diff keeps `+xab\n+cdy`. The short-secret rule still requires a break before and after the token (`packages/capture/redact.ts:65`). |

`maskSplitStreams` still runs before `mapHook` (`packages/capture/handle.ts:65`). The existing split-secret test passed inside `test:capture`.

The classification test at `packages/capture/capture.test.ts:249` fails on the whole-input order. `npm test` with `MY_API_KEY=test` becomes type `tool_call`. The same command with `MY_PASSWORD=pass` stays type `test` and becomes status `unknown`.

## Findings

### Minor — the new short-secret test stays green on the code that had major 1

`packages/capture/capture.test.ts:233`, `packages/capture/redact.ts:2`, `packages/capture/redact.ts:45`.

`ab12\ncd34` is a long secret. The second review's leak needs a secret of length 4 to 7 that contains a newline, such as `ab\ncd`.

Failure: a later change redacts edit text with `redactValue`, or calls `redactString` without short secrets. `old_string` and `new_string` are still outside `FREE_TEXT_KEYS` (`packages/capture/redact.ts:8`), so `ab\ncd` survives until `hunk` splits it. The events file stores `"-ab\\n-cd\\n+k = ab\\n+cd\\n+rest"`. Replay draws `payload.diff` (`apps/web/replay/page.tsx:157`). This test still passes, because its 9-character value is removed by the long-secret pass before the diff is built.

The current tree does redact `ab\ncd` for `Edit`, camelCase keys, `MultiEdit`, and `Write`. The probe above is the evidence. The test in the repo does not lock that.

### Minor — a line whose text starts with `++` is dropped from follow-up

`packages/capture/map-hook.ts:69`, `packages/questions/src/adapter.ts:41`. Unchanged since the second review.

Failure: `new_string` is `+kept\n++dropped`. The diff is `-a\n++kept\n+++dropped`. Follow-up keeps `+kept` and drops `dropped`. Replay paints `+++dropped` as diff metadata (`apps/web/replay/page.tsx:66`).

## Commands

The first chain saw `NO_COLOR=1` and `FORCE_COLOR=1`. `npm run -s check` exited 0 and printed nothing. `test:capture` then failed four hook CLI stderr checks and did not reach `fixture:verify` or `test:questions`. The new mapping tests passed in that run. Tail (exit 1):

```text
 FAIL  packages/capture/capture.test.ts > hook cli > prints one line and exits 0 for non-object JSON null
AssertionError: expected '(node:41570) Warning: The \'NO_COLOR\…' to be 'devlens hook: payload was not an obje…'

 Test Files  1 failed (1)
      Tests  4 failed | 17 passed (21)
   Start at  22:33:37
   Duration  1.02s (tests 87%, import 7%, transform 5%)
```

Those four failures are Node's `NO_COLOR` / `FORCE_COLOR` warning on stderr. The slice does not set either variable. The chain was re-run with both unset.

`npm run -s check && npm run -s test:capture && npm run -s fixture:verify -- broken-api && npm run -s test:questions` then exited 0. `check` printed nothing. `fixture:verify` printed `PASS` between the Vitest runs. Tail:

```text
 Test Files  1 passed (1)
      Tests  21 passed (21)
   Start at  22:35:15
   Duration  904ms (tests 97%, import 2%, transform 1%)

PASS

 Test Files  6 passed (6)
      Tests  91 passed (91)
   Start at  22:35:17
   Duration  516ms (tests 79%, import 9%, transform 8%, worker 3%)
```

Verdict: PASS
