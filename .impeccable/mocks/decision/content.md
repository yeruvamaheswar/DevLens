# Real content for every sketch (DevLens /replay, golden take). Use these facts only; invent nothing.
Product: DevLens. Page: Replay. Take: broken-api golden take, recorded 2026-10-27, window recording, 4 min 38 s, consented, audio off, camera off.
Session 1: developer prompt "Run `npm test` exactly as written, with no pipes or extra flags, every time you run the tests. Fix only the failure it prints, then stop."
  - 0:30 test FAILED: "wrong base URL: expected /api, received /v0"
  - agent edit src/client.js:  - const baseURL = 'https://example.invalid/v0';   + const baseURL = 'https://example.invalid/api';
  - test FAILED: "expected Authorization header"
Session 2: same prompt.
  - test FAILED: "expected Authorization header"
  - agent edits src/client.js:  + const sessionToken = 'session';   +      Authorization: `Bearer ${sessionToken}`,
  - 2:58 test PASSED (2 of 2 assertions)
Separate re-run (a worker, not the session): PASSED. Always labeled apart from the session's own test line.
Rule links: rule-5-later-pass-v1 "verifies" the passing test to the session 2 edits; the first fix is "superseded" (kept, never hidden). "A link is not a cause."
Questions (rule-derived, each cites event ids) with developer answers, quoted verbatim, labeled "Developer answer, written after the session on 2026-10-27":
  Q1 "The test failed, and the next prompt did not mention the error. Was that deliberate?"  A: "nope"
  Q2 "Was an agent edit kept with no test until the end?"  A: "not sure."
  Q3 "Who made the first-fix and final-fix commits? Git shows them, but no hooked event does."  A: "not sure"
Coding-agent usage (context only): 11 requests · claude-sonnet-5-5 · ≈ $0.42 list-price equivalent · billed to the plan (assumed) · "Not a measure of skill or efficiency."
Unknowns: commits were made outside the recorded sessions · an inferred link is not a cause · a passing test may not be a meaningful test · nothing here predicts job performance.
Not captured: reasoning, the editor, other terminals, camera, microphone.
Provenance labels (use these words): Observed · Rule-derived · Separate re-run · Developer wrote · Unknown.
Example event id: ec6f600a…:toolu_018K2hAF…:post
Hard bans: no score, rank, grade, gauge, KPI tile, percentage, traffic-light rating of the person, "hire". No dark neon / glow / gradient blob / glassmorphism. Keep it scannable in seconds; unknowns must be clearly visible, not faint.
