---
kind: review
title: C2c hook adapter re-review
status: complete
updated: 2026-10-27
---
Summary: Both earlier major defects are fixed and the missing tests now exist. No new blocker or major defect found. Three minor findings remain.
Scope: Slice 1 of plans/review-questions-overnight.md. Files read directly: packages/questions/src/adapter.ts, packages/questions/tests/adapter.test.ts. Context: detect.ts, packages/capture/map-hook.ts, plans/c2c-review.md.
Rules: No source or test edits, commits, pushes, installs, or child agents. Probes ran from /tmp/c2c-rr/probe.ts with `npx tsx`.

## Earlier findings

| Earlier finding | Fix in code | Probe result | Test |
|---|---|---|---|
| Major: unchanged manifest not saved as snapshot | adapter.ts:73 saves `after` before the `before === after` check at :74 | After an unchanged Stop, `snapshots` holds the content. A later add plus HEAD commit gives `['questions','stop']`. | adapter.test.ts:97 |
| Major: `constructor` path crashes Stop | adapter.ts:31 uses `Object.hasOwn` on `MANIFEST_KINDS`; :71 uses `Object.hasOwn` on `snapshots`; :73 uses `defineProperty` | `constructor`, `__proto__`, `hasOwnProperty`, `valueOf`, `x/toString` all give `['stop']` and no snapshot keys. No crash. | adapter.test.ts:109 |
| Minor: unexpected git error untested | not a code change | n/a | adapter.test.ts:223 (corrupt `.git/HEAD`, expects throw) |
| Minor: symlink escape untested | not a code change | n/a | adapter.test.ts:234 (file and directory symlinks out of repo) |
| Minor: combined order and flush immutability untested | not a code change | n/a | adapter.test.ts:123 (deep-frozen state with pending, snapshots, ask; expects `diff, questions, stop`) |

## New-defect checks

- Prototype keys: a snapshot key `__proto__/package.json` stays an own property. A JSON-restored `snapshots` with a literal own `__proto__` key survives the spread at adapter.ts:65 as an own key. It does not shadow the `package.json` lookup.
- JSON round-trip: `JSON.parse(JSON.stringify(state))` keeps the keys and own-ness. The next Stop compares with the restored snapshot and correctly asks nothing. The result object keeps `Object.prototype`.
- Realpath: `canonical()` recurses to the nearest existing parent, so new files resolve. Symlinks that leave the repo give null. No regression found.

## Findings

1. **Minor: a malformed manifest at Stop throws out of `adapt`.** adapter.ts:79 calls `detectChoices`, which throws at detect.ts:73-77 on invalid JSON. Scenario: the agent leaves a half-written `package.json` at a Stop. `adapt` throws, so no `stop` input reaches the scheduler. If the caller keeps the old state, every later Stop throws until the file parses. The probe reproduced the throw. This predates the fix and is outside the earlier findings. The adapter is not wired, and CR-7 takes it off the question path, so the impact is low today. Decide before wiring: catch per manifest and skip, or document that callers must catch.

2. **Minor: one manifest under two path spellings gets two snapshots.** adapter.ts:67 and :73 key by the raw path string. Scenario: one Stop sees `package.json` and a later Stop sees `/repo/package.json`. The second lookup misses the first snapshot and falls back to HEAD. That can bring back the earlier HEAD-moved gap. The probe showed two keys for one file. Claude Code usually sends absolute `file_path` (map-hook.ts:54), so the risk is low. A fix is to key by the reader's canonical relative path.

3. **Minor: two weak test assertions.** adapter.test.ts:243 asserts `atHead` is null for the symlink, but that repo has no commits, so null is returned for that reason too. adapter.test.ts:231 asserts only `toThrow()`, not that the error is the git error rather than a pattern match miss. Neither hides a known defect.

## Verified behavior

- Read both files directly. Ran five read-only probes. All earlier defects did not reproduce.
- No source or test file was changed.

## Requested command output

`npm run -s check && npm run -s test:questions` exited 0. Typecheck printed nothing. Tail:

```text
 Test Files  6 passed (6)
      Tests  91 passed (91)
   Start at  22:01:20
   Duration  502ms (tests 77%, import 11%, transform 8%, worker 4%)
```

Verdict: PASS
