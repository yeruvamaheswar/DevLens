# C2 review — follow-up terms and live slot

Verdict: **PASS WITH FINDINGS**

Reviewed uncommitted `packages/questions/src/follow.ts`, `packages/questions/src/live.ts`, `packages/questions/tests/follow.test.ts`, and `packages/questions/tests/live.test.ts` against the C2 contract in `packages/questions/src/types.ts`, policy lines 239–310 of the exploration plan, and contract rows NOT-1, NOT-8, and DEC-14. No files were changed except this report.

The happy path matches the required rules. Term extraction, the follow-up sentence, one follow-up per choice question, the live gates, delivery labels, mute, and the in-order session_end / report_close moves all behave as specified. Two findings are below.

## Commands

`npm run test:questions` — exit 0

```
> test:questions
> vitest run packages/questions

(node:24948) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens

 ✓ packages/questions/tests/follow.test.ts (14 tests) 4ms
 ✓ packages/questions/tests/ask.test.ts (17 tests) 6ms
 ✓ packages/questions/tests/pipeline.test.ts (5 tests) 7ms
 ✓ packages/questions/tests/detect.test.ts (16 tests) 7ms
 ✓ packages/questions/tests/live.test.ts (17 tests) 11ms

 Test Files  5 passed (5)
      Tests  69 passed (69)
   Start at  16:36:45
   Duration  255ms (transform 46%, import 45%, tests 6%, worker 3%)
```

`npx tsc --noEmit` — exit 0 on the second run. The first run exited 2 on other uncommitted work, not on these files:

```
apps/web/replay/page.tsx(584,120): error TS2322: Type '{ compiled: CompiledReplay; extent: number; time: number; selected: string; highlight: Set<string> | null; onSelect: (id: string) => void; }' is not assignable to type 'IntrinsicAttributes & { compiled: CompiledReplay; extent: number; time: number; selected: string | null; highlight: ReadonlySet<string> | null; onPick: (id: string) => void; }'.
  Property 'onSelect' does not exist on type 'IntrinsicAttributes & { compiled: CompiledReplay; extent: number; time: number; selected: string | null; highlight: ReadonlySet<string> | null; onPick: (id: string) => void; }'.
```

A second `npx tsc --noEmit` after that file changed exited 0. Neither run reported a diagnostic in `packages/questions`.

## Findings

1. **Medium.** `packages/questions/src/live.ts:20` and `packages/questions/src/live.ts:86-89`. `session_end` is not sticky, and `report_close` does not retire `queued`. `track` always stores a new question as `queued` (or `suppressed`). `session_end` only rewrites questions that are already `queued` or `asked`. `report_close` only rewrites `post_session` and `deferred`. `stop` (`live.ts:46-57`) still live-asks a `queued` question after both events, because nothing records that the session has ended.

   Failure: answer `s1:choice:opt0` with `` `useReducer` ``, call `session_end`, then apply a diff whose added line contains `useReducer`. The follow-up `s1:choice:opt0:follow` is created as `queued`. `report_close` leaves that status `queued`. The question is not asked, not post-session, and not expired. The same hole exists for a `questions` batch delivered after `session_end`: the new row stays `queued` through `report_close`. A later `stop` still returns it as a live ask, including after `report_close`. A follow-up created while `muted` is the same `track` path: it stays `queued` until some later `session_end`, and stops do not ask it.

   `packages/questions/tests/live.test.ts:143-154` stops at the in-order close. It never feeds a `diff` or a `questions` batch after `session_end`, so this reducer still passes the suite.

2. **Low.** `packages/questions/src/follow.ts:27`. Whole-token boundaries are `[A-Za-z0-9_$]` only. `extractTerms` treats `.` and `-` as part of an identifier, but `matchTerm` treats them as gaps. A term therefore matches a proper prefix of a longer dotted or kebab token.

   Failure: term `os.path` matches an added line `os.path.join(a, b)`. Term `my-lib` matches `my-lib-extra`. Term `db.ts` matches `db.ts.bak`. Each queues a follow-up whose text says that later change edits the shorter name. Word-character extension is correct: `useState` does not match `useStateful`. Regex metacharacters in a term are escaped, so `` `.*` ``, `(a+)+`, and `foo|bar` do not match unrelated lines.

## Checked, not findings

- Warm-up at exactly 3:00 asks. One millisecond earlier does not (`live.ts:52`, `<`).
- Cooldown at exactly 5:00 between live asks allows the next ask. One millisecond earlier does not (`live.ts:53`, `<`). This matches "≥ 5 minutes between live questions".
- An ask aged exactly 30:00 leaves the rolling window (`live.ts:50`, `t > now - window`). With asks at 3:00, 8:00, and 13:00, the next ask is allowed at 33:00. Any half-open 30-minute span still holds at most 3 live asks. The window test's `[t, t+30)` check agrees.
- A skipped or answered question is not asked again. No status returns to `queued`.
- A follow-up is not created for a follow-up (`live.ts:78`, `rule_id !== 'C1.choice.v1'`), and a second diff does not add another follow-up for the same parent.
- Follow-up text, id `${parent}:follow`, and evidence order (parent ids, then diff ids, deduped) match the required sentence. The text does not name a fix. The older plan sentence that says "fixed it" is not what this code emits.
- User-facing strings do not contain score, rank, hire, or penalty. The module does not call a model, write a prompt, or send a question anywhere except `LiveStep.ask` for the panel (NOT-8).
- Inputs are not mutated. The freeze test passed. The session cap of 5 counts follow-ups and suppresses the next one. The oldest `queued` row is the one a stop asks.
