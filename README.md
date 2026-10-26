# DevLens

DevLens is an evidence agent for a consented coding task. A reviewer opens DevLens Replay, clicks a claim, and sees the recording, the event, the code change, and the test result together.

The page does not score, rank, or recommend a hire.

## Hackathon

AITX and MLOps World Community Hackathon, Antler Agents track. Submission deadline: Thursday, 29 October 2026, 5:00 PM Central.

## Scope

Teammates: the implementation spec is [docs/implementation.md](docs/implementation.md).

The decision list is [plans/devlens.contract.md](plans/devlens.contract.md). The page is [plans/devlens.contract.html](plans/devlens.contract.html).

The short explainer is [plans/hackathon-explainer.md](plans/hackathon-explainer.md). The page is [plans/hackathon-explainer.html](plans/hackathon-explainer.html).

What must ship:

- One small task whose API integration is broken
- A Claude Code session captured as redacted events
- Fixed rules that link a failed test to the later passing test
- A window recording the developer chose, synced to those events
- A reviewer page that plays that recording from Supabase, with a local fallback if the network fails
- Three cited questions, an unknowns panel, and no score

If time permits, before Thursday noon:

- Six more scenarios a developer can open. Each starter test fails.
- Desktop capture as a second opt-in. The page labels that take desktop.

After the fair:

- A virtual desktop the developer can download and install tools on.
- The same evidence model over a week-long project.

## Stack

TypeScript CLI, Supabase Postgres, Supabase Storage, and a Next.js page.
