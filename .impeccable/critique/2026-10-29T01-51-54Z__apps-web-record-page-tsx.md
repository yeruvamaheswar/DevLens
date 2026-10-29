---
target: /record page
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/UmaYeruva/Code-Git-Repos/DevLens/apps/web/record/page.tsx"
target_fingerprint: "sha256:ed478ad16c0c884652619057b18868c2d6d17ba0c7f3262d21763887b505779a"
target_path: /Users/UmaYeruva/Code-Git-Repos/DevLens/apps/web/record/page.tsx
timestamp: 2026-10-29T01-51-54Z
slug: apps-web-record-page-tsx
---
Method: dual-agent (A: ac3bd6a9fb772a053 · B: ae8cb897321126195). Browser overlay skipped: no dev server; user screenshot used.

Design Health Score: 21/40 (Acceptable). H1 3, H2 2, H3 2, H4 2, H5 3, H6 2, H7 2, H8 2, H9 1, H10 2.

Specificity: partly specific. StateLine glyph is Transit Line; the rest reads as a generic consent form (h1, four equal ink rules, bullet lists, agent as plain bordered button). Detector: 0 findings.

Priority issues:
- P1 Two capture channels are hidden: hooks capture prompts, tool calls, diffs and tests whatever the video state, but the page says "Nothing is recorded until you click". Fix: name both channels (Session log: on via hooks, project, live event count; Screen video: off until you click).
- P1 State is not the hero: 12px chip same weight as buttons; no elapsed time; no tab-title cue; closing the tab silently ends the take. Fix: full-width state line, 26px word, mm:ss, document.title and TopBar take slot, "Keep this tab open" line.
- P1 Agent reads as a form control, not a background agent; empty "Question queue (0)" section. Fix: one agent row, role=switch, status word + mark (Off / Watching this session / N questions waiting · open the widget / Offline / Unavailable + fix).
- P2 Consent far from decision: desktop risk text ~900px below its button; "(second opt-in)" 3 times. Fix: risk text under the desktop button; captured lists beside the buttons; collapse while recording.
- P2 Dead ends and jargon: uploaded has no next step; "Captured surface: monitor.", "DEVLENS_PROJECT_DIR is not set" in a disabled button; error recovery scores 1. Fix: next-step link, label/value facts, errors with a fix.

Personas: judge cannot tell what the agent asks or whether answers are recorded; developer mid-session has no clock or tab cue; screen-reader user hears agent state twice and no phase word in the live region.
Minor: h2 16px off-scale; 2.5px and 6px borders not in DESIGN.md; #0b0e10 hard-coded; .agent-item border 1.43:1; buttons ~36px tall; "A score" belongs in a limits line; .record-lede unused; 880px column leaves half of a wide screen empty.
Questions: should the switch live in the widget too; should the pill show the recording dot; is the page one recorder or two channels.
