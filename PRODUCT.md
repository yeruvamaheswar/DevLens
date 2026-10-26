# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: hackathon judges and reviewers (Antler Agents track). They have a few minutes. They click one event and need the evidence on one screen.
Secondary, unconfirmed: the developer who records a session, and a later hiring reviewer.

## Product Purpose
DevLens turns a developer's AI-assisted work session into reviewable evidence. A reviewer sees what the agent did, what the tests said, and what the developer asked and answered. Success this week: one clickable golden replay, submitted before 2026-10-29 17:00 America/Chicago.

## Positioning
Evidence, not judgment. Edges come from fixed rules, never from a model. A separate worker re-runs the tests and labels that result apart from the session's own test line.

## Operating Context
Claude Code is the only capture adapter. Hooks append redacted JSONL. Supabase stores events, edges and recordings. Window recording is opt-in and starts only after an explicit click. Audio and camera stay off. Desktop recording is a second opt-in.

## Capabilities and Constraints
- Surfaces in scope for redesign: `/replay`, `/record`, a new home page at `/`, and a scenario catalog. The catalog depends on Slice 8 and is not built yet.
- A reviewer click seeks the recording to the event. One screen shows the diff, test output, question and answer (REQ-8).
- No score, rank or hire verdict anywhere in the UI.
- Stack: existing Next.js app in `apps/web`. The record page logic is tested and verified. Restyle it without changing its behavior.
- Deploy target and deployed replay URL: undecided.

## Brand Commitments
Name: DevLens. No logo or brand assets confirmed.

## Evidence on Hand
Recorded fixture and `examples/broken-api` exist. Slice 4 recorder was checked by the user in real Chrome (2026-10-26). A real golden recording is unconfirmed. Do not fabricate sessions, customers or metrics.

## Product Principles
1. Show evidence next to its source event. Never show a conclusion without it.
2. Label what the model said, what a rule derived, and what a worker re-ran.
3. Consent is visible: recording state is always clear.
4. No verdicts. The reviewer decides.

## Accessibility & Inclusion
Follow the system light/dark setting. Target WCAG AA. Recording state must not rely on color alone.
