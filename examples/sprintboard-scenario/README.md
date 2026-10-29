# SprintBoard scenario fixtures

Reference fixtures for the SprintBoard demo. They are labeled **demonstration fixtures**: hand-written reference patches. They are **not captured agent work**.

The app lives in a separate repo: `/Users/UmaYeruva/Code-Git-Repos/sprintboard-demo` (tag `starter` is the starting state). The patches are kept here so the agent working in that repo cannot see them.

## The three states

| State | How to reach it | `npm test` result |
|---|---|---|
| Starter | tag `starter` | Fails 2 tests: `status=in-progress` returns **400**, so `expected status 200 ... got 400`. |
| Incorrect fix | starter + `incorrect-fix.patch` | Fails the same 2 tests for a new reason: status is 200 but `expected 3 in-progress issues, got 0`. |
| Final fix | starter + `final-fix.patch` | All 26 tests pass. |

`incorrect-fix.patch` only adds `in-progress` to the allowed filter list. `final-fix.patch` adds one `normalizeStatus()` in `src/status.js` and uses it for the filter and for POST/PATCH.

## Commands

```sh
# Check all three states on a throwaway copy of the starter tag. Exits non-zero on a mismatch.
node examples/sprintboard-scenario/check.mjs

# Reset the real checkout to the starter state and reseed (run before the demo).
examples/sprintboard-scenario/reset.sh
```

`check.mjs` never touches the real checkout. `reset.sh` refuses to run outside the sprintboard-demo repo. It leaves `data/` alone except for reseeding the DB file.
