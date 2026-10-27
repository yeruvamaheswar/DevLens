# C1b review — `ask.ts` / `ask.test.ts`

**Slice:** Review Questions C1b (ask template, peers, dedupe, recordAnswer)  
**Reviewer:** independent (did not build)  
**Date:** 2026-10-27

## Verdict

**PASS WITH FINDINGS**

Implementation matches the brief, `types.ts`, and plan rules for templates, peers, dedupe, ids, and verbatim answers. Tests cover the React example and main dedupe paths. Two low-severity gaps: calendar-invalid ISO strings accepted by `recordAnswer`, and missing integration assertion on full question `text` from `askChoices`.

## Commands

### `npx vitest run packages/questions/tests/ask.test.ts`

```
 RUN  v5.0.5 /Users/UmaYeruva/Code-Git-Repos/DevLens


 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  16:17:35
   Duration  257ms (transform 34%, import 31%, worker 23%, tests 12%)
```

Exit code: 0

### `npx tsc --noEmit`

(no output)

Exit code: 0

Note: no errors in `catalog.ts` / `detect.ts` at review time.

## Findings

1. **`packages/questions/src/ask.ts:50-51`** — **Low** — `recordAnswer` accepts syntactically matched timestamps that are not valid calendar dates (e.g. `2026-02-30T00:00:00Z` passes regex and `Date.parse` because the engine normalizes overflow). **Failure scenario:** storage layer trusts thrown-only validation; a malformed client sends Feb 30 and gets a persisted `answered_at` that is not a real instant users expect.

2. **`packages/questions/tests/ask.test.ts:69-75`** — **Low** — `askChoices` test asserts `id`, `rule_id`, `peers`, and evidence via `toMatchObject` but not the full `text` string. **Failure scenario:** `questionText` regresses (wrong joiner, wrong backticks, wrong `lowerFirst`) while `peersFor` stays correct; unit tests on `questionText` still pass if someone edits the wiring to pass wrong peers, but the only E2E path (`askChoices` → template) never pins the canonical React sentence.

3. **`packages/questions/tests/ask.test.ts:87-88`** — **Low** — Intra-call category dedupe is tested only when `react` is first among `react`, `reactDom`, `vue`. **Failure scenario:** implementation picks the wrong same-category option when order is `[vue, react]` (both valid first-time options); tests stay green while the asked option id flips.

## Checked and OK

- Template wording: React + two peers, one peer, zero peers; `lowerFirst` for `UI framework`, `test framework`, `database`.
- `peersFor`: max 2, catalog order, same category, exclude chosen; empty for unknown id.
- `askChoices`: new state object; input `AskState` not mutated; `${session_id}:choice:${option_id}`; `rule_id: 'C1.choice.v1'`; option and category dedupe across call and session state.
- `recordAnswer`: verbatim text (including whitespace); throws on empty, non-ISO, and clearly invalid strings in tests.
- Banned judging words spot-check in generated text (test list).
- No score, rank, or hire verdict in templates.
