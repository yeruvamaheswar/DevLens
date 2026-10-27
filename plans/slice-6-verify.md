# Slice 6 verification (independent review, 2026-10-27)

Reviewer did not build or record this take. Read-only review. Golden files stay untracked.

## Verdict: PASS WITH FINDINGS

Not marked VERIFIED. The Tech Lead decides after reading the findings.

## Check A: commands (exact output)

```
> scenario:verify
> node examples/broken-api/scripts/scenario-verify.mjs broken-api

verifier inputs, not a recorded take
starter: PASS
first-fix: PASS
final-fix: PASS

> fixture:verify
> tsx examples/broken-api/scripts/fixture-verify.ts broken-api

PASS
```

## Check B: JSONL

30 events, 0 duplicate ids, seq 1..30 strictly increasing, ts non-decreasing. Two sessions.

| Session | Prompt (exactly one) | Tests | Edits | End |
|---|---|---|---|---|
| ec6f600a (round 1) | "Run `npm test` exactly as written, with no pipes or extra flags, every time you run the tests. Fix only the failure it prints, then stop and leave the test result visible. Do not guess at further changes." | seq 3 failed (`wrong base URL: expected /api, received /v0`); seq 15 failed (`expected Authorization header`) | seq 13: src/client.js (v0 to api) | Stop seq 16, SessionEnd seq 17 |
| 44a60462 (round 2) | same text | seq 20 failed (`expected Authorization header`); seq 28 passed | seq 24: src/client.js (sessionToken constant); seq 26: src/client.js (Authorization header) | Stop seq 29, SessionEnd seq 30 |

- All 4 `test` events use the command `npm test` exactly. Bash `pre` commands for tests are also `npm test`.
- No edit touched tests/, README.md or package.json. Reads of src/client.js and tests/client.test.js only.
- No extra human prompts. No "commit", "push" or "option A" follow-up. Round 2 is a new session, not a reply in round 1.
- Other Bash calls: `grep -rn "v0" ... ; ls` (seq 4, ended as a PostToolUseFailure at seq 5), a second grep (seq 6/7), and `ls; cat tests/client.test.js; ls src; cat src/client.js` (seq 21/22). None are test runs.
- Not separately checked: the actual `linkEvents` edge list. `fixture:verify` printed PASS and I did not read its code.

## Check C: git consistency

- starter (cc2f540): README.md, package.json, src/client.js, tests/client.test.js.
- first-fix (5f95ece): `src/client.js` one line, base URL `/v0` to `/api`. Matches seq 13.
- final-fix (71d8fb2): adds `const sessionToken = 'session';` and `Authorization: \`Bearer ${sessionToken}\`` only. Matches seq 24 and 26.
- Commit author email in git-log.txt is yeruva.maheswar@gmail.com. See finding F7.

## Check D: redaction

| Pattern | Count |
|---|---|
| sk- | 0 |
| eyJ (JWT) | 0 |
| api key, password, SUPABASE, service_role | 0 |
| email addresses | 0 |
| `Bearer` | 4, all `Bearer ${sessionToken}` from task code |
| `/Users/UmaYeruva` | 34 (accepted, to be disclosed in README) |

## Check E: video

- ffprobe: codec vp8, duration 276.75 s, stream header 238x152.
- Per-frame sizes: 3 frames at 238x152 (pts 0.000, 0.025, 0.063 s), then 3088 frames at 2462x1582. The 238x152 figure is a header artifact of the first frames. The real take is 2462x1582.
- I extracted 28 frames (fps=1/10) outside the repo into /tmp/slice6-native, scaled to 1600 px wide. A plain `ffmpeg -vf fps=1/10` with no scale outputs 238x152 PNGs, because ffmpeg locks to the first frame size. Anyone who extracts frames or generates a poster this way gets unreadable images. A player that trusts the header may also show the take small.
- Legibility at 2462x1582 (viewed at 1600 wide): text is clearly legible. Prompt, edits (diff colors), summaries and prompt lines are all readable.
- Only the terminal window is visible. No menu bar, browser, notification or other window.
- No key, token or secret seen. The `Bearer session` token is task code.
- Round 1 is visible (f007 to f012): prompt, grep, `Update(src/client.js)` diff of v0 to api, and the assistant text that names the failing `expected Authorization header (tests/client.test.js:54)`.
- Round 2 is visible (f020): both edits, "npm test now passes: 1 test, 0 failures."
- The raw `npm test` output is NOT visible in any frame I viewed (f001, 003, 005, 007, 009, 012, 015, 020, 024, 028). Claude Code collapses tool output to "Ran 1 shell command". The failing assertions appear only in the assistant's prose. I did not view the other 18 frames.
- First and last frames (f001, f015, f028) show a plain zsh window with scrollback from earlier takes: directories `devlens-broken-api-WrQnf4` and `devlens-broken-api-ZZKlmJ`, resume ids, and a host prompt `UmaYeruva@UmaY-MacBook-Pro`.
- The title bar in round 1 shows the stale folder name `devlens-broken-api-WrQnf4` while the path line shows `...pUCjfJ`.
- The input box in round 1 shows greyed suggestion text "Yes, fix the Authorization header". JSONL confirms it was not submitted.

## Check F: Supabase (read-only SELECT, project hivfaqlabtbrhrviwrrm)

Found `recordings/d4ce73f0-7d0c-4e05-aa02-a5d1ec359493/take.webm`, size 16047324, created 2026-10-27 16:16:28 UTC. Matches.

## Findings

| # | Sev | Where | Observed | Recommendation |
|---|---|---|---|---|
| F1 | Medium | session.webm header and first 3 frames | Stream header says 238x152. Only 3 initial frames use it. The remaining 3088 are 2462x1582. Naive ffmpeg or a header-trusting player gives a tiny or unreadable picture. | Test playback in the target browser and in the replay UI. If it renders small, re-mux or re-encode at a fixed 2462x1582 or 1600x1028 (drop the 3 frames). Re-upload and update the size check. |
| F2 | Medium | frames f007, f012, f020 | Raw `npm test` output (assertion lines) is not on screen. Only the assistant's summary names the failures. Accept criterion 5 says the work is legible. The failing assertions are legible only as prose. | Decide if prose is acceptable. If not, re-record with tool output expanded (ctrl+o) or add a visible `npm test` run. Alternatively note this in the README. |
| F3 | Low | f001, f015, f028 | Scrollback from earlier takes and the host prompt (username, `UmaY-MacBook-Pro`, temp dir names) are shown for about 10+ s at the start and end. No secrets. | Trim the first and last idle segments, or disclose in README. |
| F4 | Low | session.jsonl seq 25 | Edit input `new_string` is stored as `Authorization: [REDACTED]`. Redaction swallowed the header line, which is not a secret (`Bearer ${sessionToken}`). Replay and linker cannot show the real edit content for seq 26. | Review the redaction rule for lines containing `Authorization`. The git diff holds the true content. Decide if the loss matters for replay. |
| F5 | Low | session.jsonl seq 5 | PostToolUseFailure for a grep with `ls` in round 1. Harmless, but it is an extra failure event in the log. | None required. Know it exists when checking linker edges. |
| F6 | Low | Round 1 vs round 2 | Round 2 starts a fresh session with the same prompt on the first-fix working copy. It is not a continuation. The take is two sessions. | Confirm this matches the contract's "two sessions" expectation. |
| F7 | Low | git-log.txt | Contains commit author name and email (yeruva.maheswar@gmail.com), which differs from the Claude account email. | Redact or disclose before any commit of git-log.txt. |

## Accept criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Starter test fails | PASS (seq 3, scenario:verify starter PASS) |
| 2 | First fix fails the second assertion | PASS (seq 13, 15; first-fix commit) |
| 3 | Final fix passes | PASS (seq 28; final-fix commit) |
| 4 | JSONL real, consistent, linkEvents edges | PASS for IDs and ordering. Edge list NOT CHECKED directly; `fixture:verify` printed PASS. |
| 5 | WebM shows only the chosen window, legible | PASS WITH FINDINGS: single terminal window, legible at 2462x1582, but see F1 (header size) and F2 (no raw test output) |

## Not checked

- Playback in a real browser or the replay UI (F1 impact is unconfirmed).
- 18 of 28 extracted frames were not viewed.
- The `linkEvents` edge list and fixture-verify source.
- Full-size (2462 px) pixel legibility. I viewed frames scaled to 1600 px wide.
- Scratch files stayed in /tmp (/tmp/slice6-native, /tmp/s6.mjs, /tmp/s6b.mjs).
