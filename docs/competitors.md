# How DevLens differs

This note matches the implementation plan on `main` at commit `9b076ad` (26 October 2026): [docs/implementation.md](implementation.md).

Competitor facts were checked the same day. A cell that says **not found** means the research did not find the feature. It does not mean a vendor proved the feature is absent. Do not tell a judge that no competitor exists.

## What Thursday actually ships

The difference is the golden replay, not the later ideas.

| In the Thursday demo | Not a difference to claim this week |
|---|---|
| One task, `examples/broken-api` | A catalog of seven scenarios. Other six are tasks only if the replay already works |
| Consented window recording, synced to events | Desktop capture. It is a second opt-in, and only if time remains |
| A rule that links the failed test to the later pass | Supabase. That is where the rows live. It is not the product |
| DevLens re-runs the test | A downloadable virtual desktop. After the fair |
| The developer answers one question in their own words | A week-long project. After the fair, and not the pitch |
| The reviewer clicks the claim and sees the recording, the diff, and both test results | A score, a rank, or a hire recommendation. Those stay out |
| The page says what it does not know | |

## What is already common

Recording an AI coding session is not the wedge. These products already show prompts, tool calls, edits, or playback. Sources were read on 26 October 2026.

| Product | URL | What they already do | What they add that we will not |
|---|---|---|---|
| Outship (YC W25) | https://outship.ai | Closest product. Claude Code and Codex, local mode, prompts, edits, commands, a scrubbable timeline, a verification rubric | Labels the candidate. Example on their site: "inexperienced vibe coder" |
| CodeSubmit | https://codesubmit.io | Candidate's own Git repo. Names Claude Code, Codex CLI, and Gemini CLI. Live stream of prompts and harness actions | AI review and follow-up prompts inside a scoring product. Async agent logs were not confirmed |
| Saffron (YC P26) | https://www.trysaffron.ai/ | Employer's repo, Claude Code, line-level human/AI labels, debrief questions. Public price from $199/month | A deterministic score. Their line is that it needs no engineer time |
| CodeSignal | https://codesignal.com | Agentic assessments since 2 April 2026 with Claude Code, Codex, and Cursor. Transcripts and replay | Hosted and scored, including a suspicion score |
| Span | https://www.span.app/ | Prompts, tool calls, edits, tokens, linked sessions, joined to pull requests. Refuses people-level reports | Not a hiring product. Reports are teams and repos |

Also already in market, so do not claim them as ours:

| Capability | Who already has it | Confidence |
|---|---|---|
| Prompts, tool calls, and edits | Outship, CodeSubmit, CodeSignal, Saffron, kodwai, InterviewLM, Codility, CoderPad | High |
| Playback or session replay | CodeSignal, CoderPad, Coderbyte, Outship's timeline | High |
| Screen or full-desktop video | HackerRank's interview shares the whole desktop. Coderbyte records the screen | High for HackerRank. High for Coderbyte's screen claim |
| Questions for a human reviewer | Saffron's debrief questions. CodeSubmit drafts follow-up prompts | High |
| A verification rubric | Outship tags events, including verification, then labels the person | High for the rubric. The label is the split |
| Local capture on the candidate's machine | Outship local mode, kodwai, InterviewLM, CodeSubmit | High |
| Traces with no score | Span. It will not report on a person | High |
| A committed transcript a human reads | Rootly asks candidates to commit the transcript. Cost is zero | High |

## Where the Thursday demo is different

The combination below was not found in one shipping product. Each piece alone is easier to copy than the click that joins them.

| DevLens, Thursday demo | Closest thing a judge will name | The split |
|---|---|---|
| Fixed rules write a `verifies` edge from the later passing test to the second patch. The edge stores the rule id and the event ids. The model does not insert the edge | Outship's rubric card tags a moment "verification." CodeSignal and Saffron grade the session | Their tag supports a label or a score. Our edge is a citation. If the rule does not fire, the page says unknown |
| The worker re-runs the test. That result is a separate line from the session's own test output | Platforms show the candidate's test log | We run the check again. If the re-run does not support the claim, we do not keep the claim |
| When the test fails, DevLens asks what failed and stores the typed answer. The page quotes those words | Saffron and CodeSubmit ask the reviewer questions after the session | The answer is the developer's words, next to the failure. It is not a trait and not a paraphrase |
| One click seeks the window recording to that event and shows the diff, the question, the answer, and both test results | Replay products play the session. Span stores the trace. HackerRank shows the desktop | The recording is the picture. The claim comes from the hook, the git trailer, and the test. Footage with no event is not a claim |
| No score, no rank, no "met," no hire recommendation. Unhooked edits are unattributed, not human | Span refuses people-level scores, but it is not hiring. Valuate.dev says the AI never passes or fails, and it still scores | We stop at three questions a person can ask |

That is a narrow difference. Outship or CodeSubmit can add a linker. The hackathon bet is that the click works on Thursday, not that they cannot copy it.

## What we should not use as the difference

| Idea in the plan | Why it does not win the comparison |
|---|---|
| Supabase | Postgres and a file bucket. Judges will not remember the vendor |
| Seven scenario folders | Assessment vendors already have task libraries. Only `broken-api` is the recorded demo |
| Desktop mode | HackerRank already shares a full desktop. Ours is opt-in and labeled, and it is not the must-ship path |
| A virtual desktop after the fair | Not in this submission. Do not demo a promise |
| A week of observation | Not in this submission. Candidates reject long take-homes. Do not describe a synthetic week as real |
| "We record Claude Code" | Outship, Saffron, CodeSignal, and CodeSubmit already do |

## If a judge asks

| Question | Answer |
|---|---|
| How is this different from Outship, Saffron, or CodeSignal? | They already record the session, and they score. We link a failed test to the patch that replaced it, re-run the test, and stop at questions. They can copy that. The demo is the working link. |
| Why not read the Claude transcript? | You can. Rootly asks candidates to commit transcripts. The difference is a cited chain and a re-run, so the reviewer does not scroll a JSONL file. |
| Why not Span or Langfuse? | Those stores are for teams and apps. Span says reports are never about individual people. This page is one consented task for a human reviewer. |
| Isn't desktop recording what HackerRank does? | Yes. Their interview can share the whole desktop. Our must-ship recording is one window the developer picked. Desktop mode is optional, labeled, and not the claim. |
| Are seven scenarios the product? | No. One recorded scenario is the product. The other folders are extra tasks if the replay already works. |

Do not say "no one else does this," "we predict who to hire," "fewer tokens means a better engineer," or "this is seven days of observation."
