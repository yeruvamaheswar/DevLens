# Slice 4 review: Multi-line capture diff

Independent review of the uncommitted diff in `packages/capture/map-hook.ts` and `packages/capture/capture.test.ts`. The builder's claim was checked against that diff, the Accept line in `plans/review-questions-overnight.md`, and a probe that imported `mapHook`, `redactValue`, `adapt`, and `matchTerm`. No other repo file was edited.

## Accept

The new test meets the Accept line for the case it names. `capture.test.ts:201` expects the exact string `-one\n-two\n+x\n+y\n+z`: two `-` lines and three `+` lines, with no space after the sign. The same test locks one `MultiEdit` hunk (`-a\n+b\n+c`), a `Write` of `content` (`+p\n+q\n+r`), and a 4000-character `new_string` that drops `payload.diff`.

The 4000 limit in `map-hook.ts:91` is unchanged (`diff.length > 4000` returns no diff). A probe kept a diff of length 4000 and dropped one of length 4001. The test does not pin that boundary: `'b'.repeat(4000)` makes the prefixed diff 4004 characters, so any cap at or below 4003 would still pass.

## Consumers of the old form

`examples/broken-api/fixtures/golden/session.jsonl` still stores the spaced, first-line-only form. The three `file_edit` diffs are:

- `- https://example.invalid/v0\n+ https://example.invalid/api`
- `- const baseURL = 'https://example.invalid/api';\n\n+ const baseURL = 'https://example.invalid/api';\nconst sessionToken = 'session';\n`
- `-       Accept: 'application/json',\n\n+       Accept: 'application/json',\n      Authorization: [REDACTED]\n`

Nothing rewrites that file through `editDiff`. `fixture:verify` passed.

- `packages/questions/src/adapter.ts:41` still keeps a line that starts with `+` and not `+++`, then drops that one character. The golden line `+ b` becomes ` b`. `adapter.test.ts` still expects that leading space, and `test:questions` passed (91 tests).
- `packages/questions/src/follow.ts` matches terms inside those added lines. It does not parse the sign itself. A normal new line `const x = useQuery()` still matches `useQuery`.
- `packages/link/` does not read diff text. `linkEvents` only cares that the payload is part of the event. The golden run got through `fixture:verify`.
- `apps/web/replay/page.tsx:66` classifies a line by its prefix. A golden line that starts with `+ ` or `- ` still renders as an add or a delete. Continuation lines in the golden diffs have no sign, so they still render as context. That shape was already in the fixture.

`adapter.ts:39` still describes the diff as `"- old\n+ new"`. New captures omit the space. The strip of one `+` still works for both shapes.

## Edge cases probed

| Case | Result |
|---|---|
| CRLF `one\r\ntwo` / `x\r\ny\r\nz` | `-one\r\n-two\n+x\r\n+y\r\n+z`. The CR stays on the line. `useQuery` on a CRLF line still matches. |
| Trailing newline | `content` `p\nq\n` becomes `+p\n+q\n+`. See minor finding. |
| Empty `old_string` | No diff. `text()` at `map-hook.ts:13` rejects `""`, and `hunk` then returns null (`map-hook.ts:73`) because `new_string` is set. The previous hunk had the same null result. Unchanged. |
| Empty `new_string` | No diff. Same `text()` rule. Unchanged. |
| `MultiEdit` with two edits | `-a\n-b\n+c\n-d\n+e\n+f`. The test covers only one edit. The loop in `editDiff` joins every hunk. |
| Single-line secret and `API_KEY=` | After `redactValue`, the diff is `-a\n+const k = "[REDACTED]"\n+next` and `-a\n+API_KEY=[REDACTED]\n+keep`. The signs stay. |
| Secret value `line1\nline2` | The diff stays `-a\n+line1\n+line2`. See major finding. |

## Findings

### Major — a secret that contains a newline survives in `payload.diff`

`packages/capture/map-hook.ts:69`, applied before `packages/capture/handle.ts:46`. `packages/capture/redact.ts:59` only replaces a secret it finds as one contiguous string. `diff` is a free-text field (`redact.ts:8`).

`hunk` now puts `+` or `-` at the start of every line, then `handleHook` redacts the finished event. A secret value `line1\nline2` is still one string in `raw.tool_input.new_string`, and that copy is redacted. In the diff the same text is `+line1\n+line2`, which does not contain `line1\nline2`, so `payload.diff` keeps both lines.

Failure: an env secret of 8 or more characters that includes a newline (a PEM block, or any multi-line token) is inside an `Edit` `new_string`. The events file and the replay hook diff (`apps/web/replay/page.tsx:157`) show the secret. The new test calls `mapHook` and never `handleHook`, so this stays green.

The previous hunk was `- ${old}\n+ ${new}` with the rest of `new_string` left intact, so that same secret was one substring and was replaced.

### Minor — a trailing newline adds an empty signed line

`packages/capture/map-hook.ts:69`. `split('\n')` keeps a final empty segment when the string ends with `\n`.

Failure: a `Write` of `p\nq\n` is stored as `+p\n+q\n+`. Replay draws a blank added line. The questions adapter puts `""` in `added`. A follow-up term does not match that empty string. The new test uses `x\ny\nz` and `p\nq\nr`, with no trailing newline, so it does not see this.

### Minor — a line whose text starts with `++` is dropped from follow-up

`packages/capture/map-hook.ts:69` writes the sign with no space. `packages/questions/src/adapter.ts:41` drops a line that starts with `+++`. `apps/web/replay/page.tsx:66` paints `+++` and `---` as diff metadata.

Failure: `new_string` is `+kept\n++dropped`. The diff is `-a\n++kept\n+++dropped`. Follow-up keeps `+kept` and drops `dropped`. Replay paints `+++dropped` as a header. A removed line `--- rule` is stored as `---- rule` and painted as a header, not a deletion. The spaced form `+ ++dropped` used to survive the `+++` filter.

## Commands

`npm run -s check` exited 0 (no tsc output, and `test:capture` started). The chained command then failed in `test:capture` and did not reach `fixture:verify` or `test:questions`.

Tail of that run (exit 1). The four failures are the hook CLI stderr equality checks. Node printed `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set` before `devlens hook: payload was not an object`. The new multi-line test passed in this same run. This runner sets both color variables. The slice does not.

```
FAIL  packages/capture/capture.test.ts > hook cli > prints one line and exits 0 for non-object JSON null
AssertionError: expected '(node:26084) Warning: The \'NO_COLOR\…' to be 'devlens hook: payload was not an obje…'

 Test Files  1 failed (1)
      Tests  4 failed | 13 passed (17)
```

Re-run of `npm run -s test:capture` with `NO_COLOR` and `FORCE_COLOR` unset: 17 passed, exit 0.

`npm run -s fixture:verify -- broken-api` printed `PASS`, exit 0.

`npm run -s test:questions` tail:

```
 Test Files  6 passed (6)
      Tests  91 passed (91)
```

Exit 0.

Verdict: FAIL
