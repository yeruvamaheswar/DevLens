# H1a and H1b verification (independent)

Date: 2026-10-27. Verifier did not build the slices. No source file edited. Server on port 3100 was started and stopped (port 3000 untouched).

## Verdict: PASS WITH FINDINGS

All four checks pass. Findings are low severity (process gaps and future-proofing), none block.

## Commands

| Command | Result |
|---|---|
| npm run check | PASS (tsc --noEmit, no output) |
| npm run test:replay | PASS (3 files, 12 tests) |
| npx vitest run packages/core/usage.test.ts | PASS (5 tests, none skipped, so the real-transcript test ran) |
| npm run fixture:verify -- broken-api | PASS |
| npm run check:bundle | PASS, but see finding 1 (stale build in repo). Re-run on a fresh build of the current tree in a /tmp copy: PASS |
| npm run test:link | PASS (13 tests) |

## Check 1: usage.jsonl and totals

- 11 lines. Keys on every line: session_id, request_id, model, input_tokens, output_tokens, cache_write_5m, cache_write_1h, cache_read, list_price_usd, price_table, billing_route. No text field. grep for "/Users" or "home": 0 hits.
- Independent recompute (own Python, dedup by requestId, last line wins) from both transcripts: 11 requests, model claude-sonnet-5-5 only, input 22, output 2434, write 5m 0, write 1h 82753, read 664323, USD 0.4218283. Matches the file, per request, and matches the expected figures.
- Output tokens do not vary between duplicate lines of one request (20 lines, 11 requests), so "last wins" is safe for this data.

## Check 2: usage panel wording

- Rendered /api/replay JSON on a fresh build: billing_route_label "plan (assumed)", price_table_date "2026-10-27", panel title "Coding-agent usage (context)", USD labeled "List-price equivalent".
- Regex over usage, unknowns, questions and claim for efficien|score|rank|better|worse|hire|ratio: only hit is the allowed sentence "...not a measure of skill or efficiency." ("ratio" hits are inside "duration").
- Source grep of page.tsx, view.ts, questions.ts, usage.ts: no rank, score, better, worse, ratio. page.test.ts bans efficient|score|rank|better|worse|hire.
- Wording "Not comparable to other sessions" and "not charged per token" appear in the note. They are disclaimers, not comparisons. Judged acceptable (see finding 3).

## Check 3: answers

- answers.jsonl texts are exactly "nope", "not sure.", "not sure". API returns the same strings, linked to the three real question ids, each with label "Developer answer, written after the session on 2026-10-27. Not captured during the take."
- page.tsx renders `question.answer.text` in a `<blockquote>` with `whiteSpace: pre-wrap` (React-escaped, no processing).
- ANSWER_ABSENT appears only with zero answers: confirmed with files present (absent, replaced by "Developer answers were written after the session...") and with files missing (present). Unit test covers both.
- No interpretation of answers anywhere in the diff.

## Check 4: browser bundle and offline

- Fresh `next build` of the current tree in a /tmp copy (the repo .next is stale, finding 1). Grep of .next/static for node:fs, readFile, .claude/projects, homedir, usageFromTranscript, findTranscript, loadGoldenExtras, golden/usage, session id: 0 hits. The new panel string is present in a client chunk.
- page.tsx imports only types from ./view (`import type`), so usage.ts (node:fs, os) stays server-side. Only route.ts reads transcripts' derived files; nothing reads ~/.claude at request time (only the `usage:golden` script and a skipped-if-absent test do).
- Offline path with usage.jsonl and answers.jsonl removed, served by `next start -p 3100`, both `?offline=1` and default: usage null, answers_present false, answers null, old unknown lines shown, no error.

## Findings

1. Low, process. package.json:11 / packages/core/bundle-check.ts:3. `check:bundle` scans whatever apps/web/.next/static exists. The repo copy was built at 13:20, before this diff, so the PASS says nothing about H1. Failure: a leak added in H1 would pass check:bundle until someone rebuilds. Mitigation: I rebuilt in a /tmp copy and it passed. Run `npm run build` before `check:bundle` for the record.
2. Low, scope. apps/web/replay/view.ts:56-58 (answerLabel) and packages/core/event.ts (PostSessionAnswer.delivery is only 'post_session'). REQ-23 requires labels `live` or `post_session`. The label text always says "written after the session". Failure: a future `live` answer would be mislabeled, and the type rejects it. Fine for the golden take, which has only post_session answers.
3. Low, wording. apps/web/replay/view.ts:219. The note says "Not comparable to other sessions" and "not charged per token". No banned word, but no test guards "compar*" or "per token", and the view.test.ts verdict regex (view.test.ts, "keeps verdict words out") omits ratio and compar. Failure: a later edit could add "comparison" wording and pass the tests.
4. Info. packages/core/usage.ts:68-73 and packages/core/fixture.ts:18-21. A malformed line in usage.jsonl or answers.jsonl throws, so /api/replay returns 500 for the whole replay, including offline mode. Missing files are handled. Acceptable for a committed fixture; noted for the demo.
5. Info, coverage. Page rendering was verified through the API JSON, a source test, and the built chunk, not in a browser DOM. Not behaviorally verified: the visual layout of the panel and the answer blockquote.
6. Info. answers whose question_id matches no current question are silently dropped (view.ts questions map). answers_present would still be true and hide ANSWER_ABSENT. Not triggered by the golden data.
