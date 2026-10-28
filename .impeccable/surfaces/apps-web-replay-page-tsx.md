---
version: 1
slug: "apps-web-replay-page-tsx"
primary_target: "apps/web/replay/page.tsx"
related_targets: ["apps/web/app/page.tsx","apps/web/record/page.tsx"]
---

# Surface brief: /replay (with home `/` and `/record` in the same world)

Mode: Operate. Visitor: hackathon judges and reviewers with a few minutes; later a hiring reviewer. Task: follow the fail → fix → pass chain, see where each claim came from, read the questions and the developer's verbatim answers, and see the limits. Success in 10 seconds: the chain, evidence-not-judgment, questions and answers. Must stay untouched: behavior, tests, labels required by the contract (no score, rank, verdict), consent and recording behavior on /record. Feels wrong if: it looks like a scoring dashboard, a generic AI-startup look, too dense to scan, or the limits are hidden.

Analytics the user asked for (2026-10-27): a session summary band, a test history table, and an activity-over-time strip. Every number is a count or a time and links to the events it counts. No ratios, no percentages, no gauges.

## Direction contract
THESIS: The take is a line you ride. Stations are events; the fail → fix → pass route is the one emphasised line, and the separate re-run is its own line at the interchange. Refuses the category default of a log list beside a video.
OWN-WORLD: Swiss metro diagram discipline. Cool enamel ground, ink text, cobalt session line, red failed-test stations, green terminus, amber re-run line. Workhorse grotesk at fixed label sizes, lines only at 0/45/90 degrees, flat colour, no shadows or gradients. Provenance chips pair a marker shape with a word.
STORY: The reviewer sees the whole take as one line, clicks a station, and the video seeks while the evidence (test, diff, rule link, question, verbatim answer) opens beside it. The limits stay visible at the bottom.
FIRST VIEWPORT: Top bar. Session summary band. Line diagram across the upper band, selected station focused. Lower band: video with an activity strip and station ticks at left; station evidence at right. Unknowns and not-captured strip pinned visible.
FORM: Transit Line, candidate 3 of 7 on the grounded list, seed key a3562ccd. Raises: one reserved route colour that never edits evidence; superseded stays on the line, stamped; provenance as visible layers; focus the corridor and keep context; hierarchy by scale, not boxes.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
