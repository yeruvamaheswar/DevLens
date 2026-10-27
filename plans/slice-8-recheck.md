# Slice 8 recheck after the review FAIL

Reviewer finding (plans/slice-8-review.md, two High items): `--all-starters` accepted a run when the expected text only appeared in a `console.log` line or in a syntax-error source excerpt.

Fix (`examples/broken-api/scripts/scenario-verify.mjs`): a starter passes only if `npm test` exits nonzero, the output has no `SyntaxError`, and the output contains `AssertionError [ERR_ASSERTION]: <scenario.json failure text>`.

Recheck by the Tech Lead, same mutations as the review, run in a temp copy of `examples/` under `/tmp` (repo files untouched):

| Mutation of swapped-field test | Result |
|---|---|
| none (baseline) | PASS |
| console.log the expected text, then throw an unrelated error | FAIL (rejected) |
| malformed source line that contains the expected text | FAIL (rejected) |
| test with no assertions | FAIL (test unexpectedly passed) |
| restored | PASS |

Real run after the fix: `node examples/broken-api/scripts/scenario-verify.mjs --all-starters` prints PASS for all seven scenarios. `npm run scenario:verify -- broken-api` prints starter, first-fix and final-fix PASS.

Limit: this recheck was done by the Tech Lead session, not the original reviewer. It covers the reported mutations only. A test that throws a real AssertionError with the same text for another reason would still pass, which is the same weakness the tasks' own assert messages carry.
