# DevLens presenter guide

Internal guide for anyone who presents DevLens live. The public overview is the [README](../README.md).

Use this guide to show one real evidence chain on the screen. Say only what the product does today. When you show a recording, say it is a recording.

## Ground rules

- **Show, then claim.** Every claim on stage should point at something on the screen: an event ID, a rule name, or a video frame.
- **Label recordings.** The two demo videos are scripted. Claude played the developer and typed the answers. Say so before you play them.
- **No verdicts.** Never describe DevLens as scoring, ranking, or judging a developer. It does none of these.
- **Name the status.** Claude Code capture is verified. The T3 Code adapter is experimental. Desktop recording has never been checked by a person in a real browser.
- **Do not claim a session picker.** `/replay` and the Claude Code journey open the bundled golden take only. Your own Claude Code sessions are captured, but they do not open in Replay yet.

## Pre-flight checklist (30 minutes before)

Run these from the repo root on the presenting laptop.

```bash
# 1. Stop leftover Next.js servers for this repo. A second `next dev` will not start while one runs.
ps aux | grep "next dev" | grep -v grep

# 2. Check the fixture and the code without a network.
npm run check
npm run demo:smoke -- --offline
npm run fixture:verify -- broken-api

# 3. Start the demo in offline mode. No keys, no Supabase.
npm run demo -- --offline
```

Then do these checks:

1. Open <http://localhost:3000/replay>. Confirm that the header says `local fixture`.
2. Press play once, so the browser has loaded the video before the audience sees it.
3. Open <http://localhost:3000/recruiter?source=golden> in a second tab.
4. Set browser zoom to 110–125% so the back row can read event IDs.
5. Close notifications, chat apps, and any tab that shows personal data.
6. Have the two MP4 files and the screenshots in `docs/media/` open in a local folder. They are your fallback.

Do not rely on the hosted Vercel build. Every deployment needs a Vercel team login.

## The strongest demonstrations, by impact

### 1. The evidence-chain click on `/replay` (the centerpiece)

| | |
|---|---|
| **Component** | `apps/web/replay/page.tsx`, the rules in `packages/link/src/rules.ts`, and the fixture in `examples/broken-api/fixtures/golden/` |
| **Why it matters** | One click joins four kinds of evidence: the recorded event, the diff, the independent re-run, and the video frame |
| **On screen** | The failure-to-pass line, the video at 2:57, the `pass 1, fail 0` result, the `Separate re-run` block, and three rule links |
| **What it proves** | The pass is a recorded hook event. A separate sandbox worker reproduced it. `rule-5-later-pass-v1` links it to the last edit and cites the event IDs. |

Steps:

1. On `/replay`, point at the summary band: 3 failed, 1 passed, separate re-run passed.
2. Click **Open the first failed test at 30.4 seconds**. Read the assertion aloud: `wrong base URL: expected /api, received /v0`.
3. Click **Seek to the passing test at 177.9 seconds**. The video jumps to 2:57.
4. In the panel, read the `Separate re-run` line: "A worker re-ran this test outside the session: passed."
5. Read the rule link: `rule-5-later-pass-v1: this pass verifies the edit before it (observed)`.
6. Say: "A link is not a cause. It is a citation you can check."

Likely failures:

- The video does not play. The page still shows the events, and they are the evidence.
- The port is not 3000. Read the port from the terminal.

Fallback: show `docs/media/replay-passing-test-station.png` and `docs/media/replay-rerun-and-rules.png`. Say they are screenshots.

### 2. The failure-to-fix chain on `/recruiter`

| | |
|---|---|
| **Component** | `apps/web/journey/build.ts`, `apps/web/journey/journey.tsx`, `apps/web/recruiter/journey-section.tsx` |
| **Why it matters** | It turns 30 raw events into seven steps a reviewer can follow, and it says when a step is missing |
| **On screen** | The journey line ("train line"), the amber re-run branch, and the seven-step chain with an evidence panel |
| **What it proves** | Each step is an event or a labelled group of events, and every one carries an ID. The re-run is drawn apart from the session. |

Steps:

1. Open `/recruiter?source=golden`. Point at the `Verified capture` label.
2. Trace the line: failed test (0:30), code change (0:53), still failing (0:54), developer response (2:37), pass (2:58).
3. Point at the amber dashed branch: "independent re-run passed, a separate worker, not the session, no footage".
4. In the chain strip, click **Original failure**. Show the DevLens event ID and the provider tool ID.
5. Click **Play the recording from 0:30**.

Likely failure: a click lands on the legend instead of the chain step. Click inside the numbered step box.

Fallback: `docs/media/recruiter-journey.png` and `docs/media/recruiter-evidence-chain.png`.

### 3. Observed versus inferred, on the same page

| | |
|---|---|
| **Component** | `packages/link/src/rules.ts`, shown in **Commits, re-run, and rules** on `/replay` |
| **Why it matters** | It shows that DevLens labels its own uncertainty instead of hiding it |
| **On screen** | `failed. Rule rule-4-failed-v1. inferred.`, next to `verifies. Rule rule-5-later-pass-v1. observed.` |
| **What it proves** | The same rule engine gives `inferred` when no re-run confirmed the result. The session 1 failure had no re-run, so its edge stays inferred. |

Steps:

1. Scroll to **Commits, re-run, and rules**.
2. Point at the two commit diffs. Each one says "from git, not from the hook log", and the pairing is an inference.
3. Point at the `inferred` rule-4 edge, then at the `observed` rule-5 edges.

Fallback: `docs/media/replay-rerun-and-rules.png`.

### 4. The independent re-run, live in the terminal

| | |
|---|---|
| **Component** | `packages/link/src/rerun.ts` and `packages/cli/src/rerun.ts` |
| **Why it matters** | It shows the worker does not trust the session. It runs the command itself. |
| **On screen** | A sandbox event with `source: sandbox`, `actor: ci`, and a status |
| **What it proves** | On the unfixed starter, the independent re-run reports `failed` with the real assertion |

Command (checked on 2026-10-29: it returned `failed` with `isolation: sandbox-exec`):

```bash
npx tsx packages/cli/src/rerun.ts --dir examples/broken-api --command "npm test" \
  --rerun-of demo --session demo --project broken-api --out /tmp/devlens-rerun.jsonl
tail -1 /tmp/devlens-rerun.jsonl
```

Say: "This is the starter, before any fix. The sandbox copied it, cut the network, removed secrets, and ran the test. It failed, so the worker says failed."

Likely failure: you are not on macOS. The sandbox needs `sandbox-exec`. Skip this demo on other systems.

Fallback: `npm run scenario:verify -- --all-starters`. It checks that each of the seven starters fails with a real assertion, in a temp copy. It runs plain `npm test`, so it does not demonstrate sandbox isolation. Say so.

### 5. Consent-first recording on `/record`

| | |
|---|---|
| **Component** | `apps/web/record/page.tsx`, `tracks.ts`, `gates.ts` |
| **Why it matters** | It answers the privacy question before anyone asks |
| **On screen** | "Not recording", the Captured and Not captured lists, and the two record buttons |
| **What it proves** | Nothing records until a click. Audio is never requested. The browser discards a take with audio or a camera, and the server checks the declared consent and track counts. The server does not inspect the video bytes. |

Steps: open `/record` and read the Captured and Not captured lists. Do not start a desktop recording on stage. Desktop mode has not been checked by a person in a real browser.

Fallback: `docs/media/record-consent.png`.

## 30-second elevator pitch

> When an AI agent writes the code, the pull request shows you the result, not how it got there. DevLens records a consented coding session as events: prompts, edits, and test runs. Fixed rules link them, and a separate sandbox re-runs the final test. A reviewer clicks "the test passed" and sees the event, the diff, the independent re-run, and the exact moment in the recording. Every link cites its evidence, and DevLens never scores the developer.

## Three-minute demo script

| Time | Do | Say |
|---|---|---|
| 0:00–0:20 | Show the home page | "A PR shows the final code. It does not show the failed tests, the replaced edits, or whether anyone re-ran the result." |
| 0:20–0:40 | Open `/replay` and point at the summary band | "This is a real, consented Claude Code session. 3 failed test runs, 1 pass, and a separate re-run." |
| 0:40–1:10 | Click **Open the first failed test at 30.4 seconds** | "The first failure: wrong base URL. The next panel shows the edit the agent made." |
| 1:10–1:50 | Click **Seek to the passing test at 177.9 seconds** | "The video jumps to 2:57. The test passed. A separate worker re-ran it in a sandbox and also got a pass. That is why this rule edge says observed." |
| 1:50–2:20 | Scroll to **Commits, re-run, and rules** | "Each edge names its rule and cites event IDs. This one says inferred, because no re-run confirmed it. A link is not a cause." |
| 2:20–2:45 | Open `/recruiter?source=golden` | "The same evidence as a journey line, with the failure-to-fix chain in seven steps." |
| 2:45–3:00 | Point at the "No score" card or the page footer | "No score, no rank, no verdict. The reviewer decides." |

## Five-minute deep technical demo

Use the three-minute script, then add these segments.

1. **The raw event (45 s).** Open `examples/broken-api/fixtures/golden/session.jsonl` in the editor. Find `toolu_01XNdvR4nbPMpYDTd1MRWMXd:post`. Show `type: test`, `source: claude_code_hook`, `provenance: observed`, and `status: passed`.
2. **The rule (45 s).** Open `packages/link/src/rules.ts` at `ruleLaterPass`. Show `confirmingRerun`: the re-run must match `rerun_of`, `status`, and `command`. Show the guard that emits nothing when no edit sits between the failure and the pass.
3. **The re-run (45 s).** Run demonstration 4 in the terminal.
4. **The tests (30 s).** Run `npm run test:link`. It runs 13 rule tests with no network and no model.
5. **Sync (15 s).** Say: "Video time is the event timestamp, minus the recording's start, minus pauses. Events outside the recording show no footage."

## The memorable moment

**Failed test → code change → passing test → independent re-run → one click that seeks the recording.**

The golden take supports this whole sequence. On `/replay`, click **Seek to the passing test at 177.9 seconds**. Let the video land on 2:57, then read the panel from top to bottom:

1. `Observed · TEST RESULT · pass 1, fail 0`
2. `Separate re-run · A worker re-ran this test outside the session: passed.`
3. `Rule-derived · rule-5-later-pass-v1: this pass verifies the edit before it (observed).`

Then say one sentence: "Every claim on this page points at an event you can open, and the pass was reproduced by something other than the agent."

## Technical talking points

- **What the agent does.** In the golden take, Claude Code is the coding agent. DevLens itself has one optional model call: the opt-in question agent, which asks at most one question per stop. Linking, the replay questions, and the journey use no model.
- **What the system records.** Six Claude Code hook events: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, and `SessionEnd`. They become typed events: `prompt`, `tool_call`, `file_edit`, `test`, and `stop`. Recording is a separate, opt-in window video with no audio.
- **Deterministic versus inferred.** Events are observed. Edges come from five fixed rules. An edge is `observed` only under its rule's condition. For example, rule 5 needs a matching sandbox re-run. Otherwise it is `inferred`. Agent questions are stored as `inferred`.
- **How evidence is linked.** Each edge stores `derived_by` (the rule ID) and `evidence_event_ids`. The rules are pure code, so the same events always give the same edges. The offline replay recomputes edges at load. Online mode loads stored edges, but only after it checks that every recomputed edge ID exists. Saved T3 captures store their edges at import.
- **How verification works.** `sandbox-exec` runs the test command on a temp copy. Network and writes outside the copy are denied, and secrets are removed from the environment. The result is a new event with `source: sandbox` and `rerun_of` pointing at the session's test.
- **Why these data stores.** JSONL on disk keeps capture local, append-only, and usable offline. Supabase Postgres holds events and edges under row-level security. The `link` CLI writes a session atomically through `replace_session`. Private Storage holds video, served through short-lived signed links.
- **Privacy boundaries.** Recording needs a click, and audio is never requested. Window mode is the default, and desktop needs a second opt-in. Redaction masks known secret patterns before writing. It does not catch every possible secret format. The question agent is off by default. It skips `.env*` files (except `.env.example`), key files, and `.ssh/`.
- **What DevLens cannot prove.** Who typed edits made outside Claude Code. The model's private reasoning. That an edit caused a pass. Anything a hostile process does to escape the sandbox. Anything about a person's ability.

## Difficult questions

**Why not just read the Claude Code logs?**
The log is the input. DevLens adds three things the log does not have. It adds rule edges that cite event IDs, a re-run by something other than the agent, and a click that ties each event to the video. It also lists what the log cannot show.

**Why not use Git history?**
Git shows commits, not the failed attempts between them. In the golden take, the first-fix and final-fix commits were made outside the recorded sessions. DevLens shows them as "from git, not from the hook log". It labels the pairing with the hooked edits as an inference.

**How is this different from session recording?**
A recording is pixels. Claude Code collapses tool output on screen, so the video often does not show the test result. DevLens keeps the structured event as the evidence and uses the video as context at that timestamp.

**What is the agentic component?**
Claude Code (or a T3 Code provider) is the agent under review. DevLens has an optional question agent that asks the developer short questions after a stop. Its output must cite real event IDs, or it is dropped. The evidence linking deliberately uses no model.

**How do you know a test verifies a specific change?**
We do not claim causation. Rule 5 says: the same command failed, edits happened, then it passed. That is labelled `observed` only when a separate re-run of the same command also passed. The page says "a link is not a cause."

**What happens when the recording and the event timeline disagree?**
The event log wins, and the page says so: "The log text is the evidence." Video time is computed from the recording's wall-clock start and pauses. Events outside the recording show "no footage" instead of a guessed frame.

**How do you prevent invented evidence?**
Edges come from pure code with no model, and each cites existing event IDs. Agent questions are dropped unless they cite real IDs. Missing chain steps are written as missing, never filled in.

**Can someone manipulate the recorded session?**
Yes, someone with access to their own machine can edit a local JSONL file. DevLens does not sign events today. Two things make tampering harder to hide: the independent re-run reproduces the test result on a copy of the code, and the video offers a second record. Say this plainly.

**What happens if the AI provider or network is unavailable?**
The replay, the journey, linking, and the re-run all work offline. Only the opt-in question agent needs a model. If a call fails, it asks nothing and logs the failure.

**How is DevLens different from Outship, CodeSignal, Saffron, and agent-observability tools?**
Use [docs/competitors.md](competitors.md). Recheck each product's site before you present, because these products change quickly. Based on those notes:

- These products already capture coding-agent sessions. CodeSignal and Outship also offer replay or timelines. Capture alone is not our difference.
- Their public material describes scores, suspicion scores, or labels for the candidate. DevLens stops at citations and questions.
- Our narrow difference is the rule edge that cites the failed test, the edits, and the pass. That edge is confirmed by a separate re-run and clickable to the frame.
- Team observability tools such as Langfuse are built for apps and teams. DevLens reviews one consented task.
- Do not claim a competitor lacks a feature unless the notes show it. Say: "They could build this. The working link is what we show."

## Demo reliability

| Path | When to use it | What to say |
|---|---|---|
| **Primary: live offline app** | Default. `npm run demo -- --offline` on the golden fixture | "This is running locally on the committed session." |
| **Fallback 1: screenshots** | The app will not start, or the video will not play | "These are screenshots of the same pages." |
| **Fallback 2: demo videos** | No laptop, or you need the live-capture story | "This is a scripted recording. Claude played the developer." |

Do not depend on a live coding-agent run or a live question-agent call during a short slot. Do not demo desktop recording live.

## Presentation blockers and audit

Status as of 2026-10-29, from a full read of the repository.

### P0: blocks the demo or invalidates a major claim

| Issue | Effect | Smallest fix |
|---|---|---|
| The README video links work only after the `demo-videos-v1` release exists | Links return 404 until it is published | Published on 2026-10-29. Re-check both links before you present |

Resolved on 2026-10-29: the videos were blurred before publishing. The menu bar, the macOS username, the shell prompt, `/Users/...` paths, and the device name are blurred. A text scan of every sampled frame of the blurred copies found none of them. The scan cannot see a name in a logo or image.

### P1: harms clarity, credibility, or reliability

| Issue | Effect | Smallest fix |
|---|---|---|
| The T3 demo video shows UI that is not on `main` (live-question counts, area tags). That work is uncommitted in the `t3-fullstack-demo` worktree | A viewer can see features the code does not have | Keep the README label, or review and merge that work |
| `/replay` says "Observed means a separate sandbox re-run gave the same result" (`apps/web/replay/page.tsx:771`). The journey labels every observed edge "a separate re-run agreed" (`apps/web/journey/journey.tsx:392`) | Wrong for rules 1–3. Rule 1 is always observed with no re-run | Change both strings to name each rule's condition, as in the README rules table |
| Replay and the Claude Code journey open only the golden take | No live "open my session" demo is possible | Do not claim it. Add a session picker later |
| The public repo holds the author's home path in `golden/session.jsonl` raw payloads and an email in `golden/git-log.txt` | Personal data in a public repo | The owner decides. Possible fix: scrub `payload.raw` paths and the email in the fixture, then re-run `fixture:verify` |
| `GET /api/replay` has no authentication. `POST /api/agent` and `/api/recruiter` check only the content type. `next dev` also listens on the network interface | Anyone on the venue network can reach the dev server | Present on a trusted network, or start Next.js bound to `127.0.0.1` |
| Leftover `next dev` processes block a new server (seen on 2026-10-29 on ports 3100 and 3300) | The demo will not start | Run the pre-flight `ps` check and stop them |
| A cold `npm install` from a fresh clone has not been tested. The 2026-10-29 check used a clean export of `HEAD` with existing `node_modules` | A fresh laptop may hit an install problem | Run the Quick Start once on a fresh clone before the event |
| The golden take's post-session answers are "nope" and "not sure" | They read as flippant on a large screen | Be ready to explain: real answers, typed after the session, quoted as written |

### P2: polish

| Issue | Smallest fix |
|---|---|
| No CI workflow | Add a GitHub Actions job for `npm run check` and the unit suites |
| The widget defaults to port 3100. The demo uses 3000 | Set `DEVLENS_URL`, or align the defaults |
| `next/font/google` fetches a font. Offline, the page falls back to a system font | Self-host the font, as the slide deck does |
| The T3 demo has about 2 minutes of idle screen (0:25–2:15) | Trim it for a presentation cut |
| `PRODUCT.md` and some `plans/` files still describe the original event deadline | Update `PRODUCT.md` if it becomes public-facing |
| `examples/sprintboard-scenario/README.md` says 26 tests. The saved capture shows 31 | Re-run and correct the number |
| Desktop recording has never been tried by a person in a real browser | Run one manual check before anyone demos it |

### Fixed in the README rewrite

- Removed all event and deadline references from the README.
- Corrected the `observed` and `inferred` definitions to match `rules.ts`.
- Corrected the `/record` controls (two switches, plus the widget), the T3 command list, and the T3 versions checked.
- Corrected the publishable-key description. Row-level security limits it to one test fixture.
- Added `DEVLENS_URL`, the `init` command, labelled screenshots, both demo videos with accurate descriptions, and an architecture diagram.
