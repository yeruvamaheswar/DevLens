---
kind: review
title: C2c hook adapter independent review
status: complete
updated: 2026-10-27
---
Summary: Two major correctness defects remain despite passing checks.
Scope: Slice 1 of plans/review-questions-overnight.md and the 2026-10-27 decisions and C2c row in plans/devlens-review-questions.md.
Rules: No source or test edits, commits, pushes, installs, or child agents. This Markdown file is the only review artifact.

## Findings

1. **Major — unchanged content is never saved as the previous Stop snapshot.** `packages/questions/src/adapter.ts:68` skips the snapshot assignment at line 74 when HEAD equals the working tree. Scenario: the first Stop follows a reverted manifest edit, leaving both HEAD and the working tree with no React. The next turn adds React and commits it before Stop. Since the first Stop saved no snapshot, the adapter uses the new HEAD, sees equal content, and misses the React question. This violates the approved previous-Stop baseline. A read-only runtime probe observed `snapshots: {}` after the first Stop and only `['stop']` after the addition and HEAD change. Save observed content even when detection is skipped. The unchanged test at `packages/questions/tests/adapter.test.ts:91` checks emitted inputs but does not check the saved baseline.

2. **Major — inherited object properties make ordinary non-manifest paths crash Stop processing.** `packages/questions/src/adapter.ts:28` looks up basenames on a normal object without checking ownership. A valid edit to a file named `constructor` passes the manifest filter. At `packages/questions/src/adapter.ts:67`, the normal snapshot object also returns its inherited constructor instead of a string or null. Detection then calls `text.split` on that function and throws. A read-only runtime probe reproduced this TypeError with a string-valued fake reader. Such a file should be ignored. Use an own-key lookup or an explicit manifest-name comparison, and make snapshot lookup safe for arbitrary keys.

3. **Minor — several boundary guarantees lack regression tests.** `packages/questions/tests/adapter.test.ts:153` covers real git HEAD, an unborn repository, untracked files, traversal, outside paths, and non-git construction, but not symlink escape or propagation of an unexpected git/read error. The tests at lines 51 and 81 check questions and diff separately; no fixture asserts the combined `diff`, `questions`, `stop` order. The immutability test at line 110 does not exercise a flush with populated snapshots and ask state. A future regression in these branches could pass this suite. Add focused cases without replacing the real scheduler or git behavior.

## Verified behavior and limits

- Read both new files directly, the requested context files, CLAUDE.md, and the relevant plan blocks.
- The tests use real `startLive` and `step`; only manifest I/O is replaced in scheduler fixtures. The git test uses a real temporary repository. These do not mock away the main acceptance behavior.
- Existing fixtures prove the React live ask and Vue/Angular wording, React DOM dedupe, empty Stop, SessionEnd routing, requirements detection, and basic git reads.
- Code emits available diff inputs before questions, followed by stop or session_end. It skips deleted manifests and creates new state containers rather than mutating input state.
- Git uses `execFileSync` with argument arrays and no shell. Static paths are canonicalized and constrained to the repository. Outside paths return null by the reader contract. Unexpected git-show errors are rethrown unless stderr matches a missing-file/no-HEAD pattern. A non-git directory throws. Error and symlink branches remain incompletely tested as noted above.
- No source or test file was changed. No user decision is needed to fix the two defects within this slice.

## Requested command output

`npm run -s check && npm run -s test:questions` exited 0. Typecheck produced no output. Output tail:

```text
 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens

 Test Files  6 passed (6)
      Tests  86 passed (86)
   Start at  21:31:42
   Duration  449ms (tests 50%, transform 36%, import 10%, worker 4%)
```

The additional read-only probe exited 1 on the reproduced constructor-path TypeError. This is separate from the passing requested command.

Verdict: FAIL
