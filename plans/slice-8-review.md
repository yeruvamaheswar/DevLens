# Slice 8 independent review

**Verdict: FAIL.** The six starter tasks work as written, but `--all-starters` can report PASS for an unrelated failure. This review does not mark the slice VERIFIED.

## Scope and provenance

- Target: `7273cc3fb7db59a4253d18caac56ac74c39ea1f2`. `git show --stat 7273cc3` reports 31 changed files, 254 insertions, six scenario folders, and `examples/broken-api/scripts/scenario-verify.mjs`.
- Current HEAD during review: `d5fc6b564c10e732cf5400fb36db3cc9cef66e20`. `git diff --stat 7273cc3 HEAD --` for the six folders and verifier was empty. The worktree was clean before this report.
- Read `CLAUDE.md`, the Slice 8 block in `plans/devlens-implementation.md`, all five files in each new folder, and the verifier diff. Did not read `.env` files.
- All fixes and mutations ran in fresh directories under `/tmp`; no implementation file was edited.

## Required command output

`node examples/broken-api/scripts/scenario-verify.mjs --all-starters` exited 0:

```text
broken-api: PASS
swapped-field: PASS
missing-auth: PASS
stale-cache: PASS
wrong-page: PASS
bad-date: PASS
empty-list: PASS
```

`npm run scenario:verify -- broken-api` exited 0:

```text

> scenario:verify
> node examples/broken-api/scripts/scenario-verify.mjs broken-api

verifier inputs, not a recorded take
starter: PASS
first-fix: PASS
final-fix: PASS
```

The plan's `npm run scenario:verify -- --all-starters` also exited 0:

```text

> scenario:verify
> node examples/broken-api/scripts/scenario-verify.mjs --all-starters

broken-api: PASS
swapped-field: PASS
missing-auth: PASS
stale-cache: PASS
wrong-page: PASS
bad-date: PASS
empty-list: PASS
```

## Starter task inspection and independent fix proof

Each folder has exactly `README.md`, `package.json`, `scenario.json`, one `src/*.js`, and one `tests/*.test.js` at target commit. Package scripts invoke Node's test runner. There are no dependency declarations, `node_modules`, fixture JSONL, or WebM files in these six folders. No new README claims a recorded take or gives the fix. Source and tests do not read files, use the clock or randomness, or make network requests. The two HTTP tasks inject a local mock `fetchImpl`; their `.invalid` URLs are never fetched. Each test has one assertion path that fails for the intended source defect and names that defect in the assertion message. The six failures concern different behavior: field mapping, auth header, cache update, page number, date part, and empty response handling.

For each task, I copied its folder into a fresh `/tmp` directory, ran `npm test`, changed source only, and ran `npm test` again. The original run exited 1 and contained its `scenario.json` failure text. Every fixed run exited 0 with `ℹ pass 1` and `ℹ fail 0`.

| Task | Minimal independent fix | Before / after exit | Fix clarity from failure and code |
| --- | --- | --- | --- |
| `swapped-field` | Map `name` to `record.name`, `email` to `record.email` | 1 / 0 | Clear; one line |
| `missing-auth` | Add `Authorization: \`Bearer ${token}\`` to headers | 1 / 0 | Clear; one line |
| `stale-cache` | Always call `this.store.set(key, value)` | 1 / 0 | Clear; one line |
| `wrong-page` | Use `pageNumber` without subtracting 1 | 1 / 0 | Clear; one line |
| `bad-date` | Return `day` without subtracting 1 | 1 / 0 | Clear; one line |
| `empty-list` | Use `(response.items ?? []).map(...)` | 1 / 0 | Clear; one line |

None needs more than a few lines or has an ambiguous fix for the tested contract. The failure output identifies the behavior; inspecting the small source file makes each change plausible for an AI coding assistant.

## Verifier mutation results

I copied the verifier and the seven scenario inputs into an isolated `/tmp/.../examples/` tree. Each mutation changed only `swapped-field/tests/swapped-field.test.js`, except the missing-file case. I ran that copied verifier with `--all-starters` after each change.

| Mutation | Exact relevant output | Exit | Correctly rejected? |
| --- | --- | ---: | --- |
| Syntax error: `const = 1` | `swapped-field: FAIL: expected failure "swapped fields: expected name "Ada", received email" not found in output` | 1 | Yes |
| Throw `unrelated failure` | Same expected-failure-not-found line | 1 | Yes |
| Test passes with no assertions | `swapped-field: FAIL: test unexpectedly passed` | 1 | Yes |
| Delete `scenario.json` | `swapped-field: FAIL: missing scenario.json` | 1 | Yes |
| Expected text only in a comment; throw unrelated error | Same expected-failure-not-found line | 1 | Yes |
| `console.log` expected text; throw unrelated error | `swapped-field: PASS` | 0 | **No** |
| Put expected text in a malformed source line; syntax error | `swapped-field: PASS` | 0 | **No** |

The two false accepts are reproducible because lines 106–114 check only a nonzero exit and `run.out.includes(expectedSubstring)`. Node prints console output and syntax source excerpts into that output. The verifier does not prove the named assertion failed.

## Verifier implementation checks

- **Temp location:** Lines 86–90 use `mkdtemp` under `tmpdir()`, check `assertOutsideRepo`, then copy the task. PASS.
- **Timeout:** Lines 62–67 kill `npm test` after 30 seconds. PASS.
- **Cleanup on failure:** Lines 87–120 use `finally` and recursive `rm`, including the missing-config `continue` path. PASS.
- **Network independence:** `npm_config_offline: 'true'` was added at line 58; tests use Node built-ins and local mocks. PASS for these inputs.
- **Existing `broken-api` mode:** `git diff 7273cc3~1 7273cc3 -- examples/broken-api/scripts/scenario-verify.mjs` adds the dispatch branch and offline environment setting but changes no existing `broken-api` assertions, patch flow, or output. Its required command passed. PASS for tested behavior; the shared npm environment now has the offline flag.

## Findings

| Severity | File:line | Observation | Reproduction | Recommendation |
| --- | --- | --- | --- | --- |
| High | `examples/broken-api/scripts/scenario-verify.mjs:106` | `--all-starters` accepts an unrelated failing test if expected text is printed with `console.log`. | Replace one test with a test that logs its `scenario.json` text, then throws `unrelated failure`. Copied verifier exits 0 and prints `swapped-field: PASS`. | Parse the test runner result and require the expected text in the failed test's assertion/error, with an expected test count and failure count. Do not match arbitrary combined output. |
| High | `examples/broken-api/scripts/scenario-verify.mjs:110` | A syntax error can also pass when Node prints the offending source line containing the expected text. | Replace the test with malformed `const = 'swapped fields: expected name "Ada", received email';`. Copied verifier exits 0 and prints `swapped-field: PASS`. | Require an executed test failure with the expected assertion/error, and reject parse/load failures. |

## Slice 8 acceptance criteria

| Criterion from Slice 8 | Result | Evidence |
| --- | --- | --- |
| Seven distinct scenarios can be opened | **PASS** | Six new task folders plus existing `broken-api`; inspected all six source/test pairs and ran the seven-scenario verifier. |
| Six new folders have a short task README | **PASS** | Each README is one task sentence plus `npm test`; none names the bug or fix. |
| Each has a deterministic failing starter test for its documented reason | **PASS** | All six original `npm test` runs exited 1 with their exact `scenario.json` text; one-line source fixes passed. No clock, randomness, network request, or external file input. |
| No new task claims to be recorded | **PASS** | No such claim in the six folders; no recording fixture present. |
| `npm run scenario:verify -- --all-starters` is a trustworthy acceptance check | **FAIL** | The same verifier branch falsely accepted two unrelated failures in isolated copies. The required direct Node invocation passes for current inputs. |

## Not checked

Did not check the live web catalog or open tasks in a browser, run CI, inspect recording fixtures outside the six new folders, test cross-platform behavior, or review unrelated commits and slices.
