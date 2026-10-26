# DevLens

DevLens is an evidence agent for one short, consented coding task. A reviewer opens DevLens Replay, clicks a claim, and sees the selected window, the event, the code change, and the test result together.

The page does not score, rank, or recommend a hire.

## Hackathon

AITX and MLOps World Community Hackathon, Antler Agents track. Submission deadline: Thursday, 29 October 2026, 5:00 PM Central.

## Scope

Teammates: the implementation spec is [docs/implementation.md](docs/implementation.md).

The decision list is [plans/devlens.contract.md](plans/devlens.contract.md). The page is [plans/devlens.contract.html](plans/devlens.contract.html).

What must ship:

- One small task whose API integration is broken
- A Claude Code session captured as redacted events
- Fixed rules that link a failed test to the later passing test
- A window recording the developer chose, synced to those events
- A reviewer page that plays that recorded session with the network off
- Three cited questions, an unknowns panel, and no score

## Stack

TypeScript CLI, SQLite, and a Next.js page.
