---
kind: comparison
title: How DevLens differs from competitors
status: active
updated: 2026-10-26
---
Summary: The Thursday difference is a cited test-to-fix click with a re-run and no score. Session recording is already common.
Goal: Give the team one page they can defend at the table.
Rules: Match commit 9b076ad · Not found is not verified absent · Do not claim no competitor exists
Plan: docs/implementation.md at 9b076ad
Full note: docs/competitors.md
Research date: 2026-10-26

## Loop
1. Read the comparison · user
2. Use it in the Loom and at the table · user

## Work
### Always loaded
- docs/competitors.md
- docs/implementation.md
### On demand
- The 26 October market note in the private research folder
### Steps
- [x] Compare the locked plan with the 26 October competitor pass · Cursor (auto) · docs/competitors.md is on main after this commit · delete that file
### Open
- A second pass against vendor sites after 26 October 2026: unknown

## Thursday plan this uses
| Ships | Does not define the difference |
|---|---|
| `examples/broken-api` replay | Six extra scenario folders |
| Window recording synced to events | Optional desktop mode |
| Rule-made `verifies` edge | Supabase |
| Sandbox re-run | Virtual desktop after the fair |
| Quoted answer to one failure question | Week-long project after the fair |
| Click opens recording, diff, and both tests | Any score or hire recommendation |

## Already common
| Capability | Who | Confidence |
|---|---|---|
| Prompts, tool calls, edits | Outship, CodeSubmit, CodeSignal, Saffron, kodwai, InterviewLM, Codility, CoderPad | High |
| Playback | CodeSignal, CoderPad, Coderbyte, Outship timeline | High |
| Screen or desktop video | HackerRank full desktop. Coderbyte screen | High |
| Reviewer questions | Saffron debrief. CodeSubmit follow-up prompts | High |
| Verification inside a score | Outship rubric, then a candidate label | High |
| Local capture | Outship local mode, kodwai, InterviewLM, CodeSubmit | High |
| Traces with no people-score | Span. Not a hiring product | High |

## Closest five
| Product | URL | They already | They do that we will not |
|---|---|---|---|
| Outship | https://outship.ai | Closest. Claude Code, Codex, local mode, timeline, verification rubric | Label the candidate |
| CodeSubmit | https://codesubmit.io | Own repo, named CLIs, live prompt stream | Scoring product. Async logs not confirmed |
| Saffron | https://www.trysaffron.ai/ | Claude Code, line labels, debrief questions, from $199/month | Deterministic score |
| CodeSignal | https://codesignal.com | Claude Code, Codex, Cursor, transcript, replay since 2026-04-02 | Hosted score and suspicion score |
| Span | https://www.span.app/ | Traces, tokens, dead ends, pull requests | Refuses a report about a person |

## The split
| DevLens Thursday demo | Nearest neighbor | Split |
|---|---|---|
| `verifies` edge with rule id and event ids. Model does not insert it | Outship verification tag | Their tag feeds a label. Ours is a citation |
| Worker re-runs the test on its own line | Candidate's test log | We drop a claim the re-run does not support |
| One in-session question. Page quotes the answer | Saffron questions after the session | Words stay the developer's |
| Click seeks the window to the event, with diff and both tests | Replay, Span, HackerRank desktop | Picture is not the claim |
| No score, rank, met, or hire line. Unhooked work is unattributed | Span, outside hiring. Valuate.dev still scores | We stop at three questions |

## Do not claim
| Claim | Why it fails |
|---|---|
| No one else records the session | The table above |
| Supabase is the product | It is the store |
| Seven scenarios are the wedge | Task libraries exist. One replay ships |
| Desktop recording is new | HackerRank already shares a desktop |
| This is a week of observation | Not in this submission |

## Say this
| Question | Answer |
|---|---|
| Outship, Saffron, or CodeSignal? | They record and they score. We link the failed test to the replacement patch, re-run the test, and stop at questions. |
| Why not the transcript? | Rootly already asks candidates to commit it. The difference is the cited chain. |
| Why not Span? | Span will not report on a person. This is one consented task. |
| Desktop? | HackerRank already does that. Our must-ship take is one window. |
