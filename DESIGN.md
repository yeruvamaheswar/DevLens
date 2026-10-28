---
name: DevLens
description: Evidence of an AI-assisted coding session, drawn as a metro line you ride. No verdict on the developer.
colors:
  ground: "#f3f5f4"
  surface: "#ffffff"
  ink: "#14181c"
  muted: "#4f585f"
  rule: "#c9cfcc"
  rule-strong: "#14181c"
  cobalt: "#1f4fd6"
  cobalt-tint: "#e2e9fb"
  red: "#c81e27"
  red-tint: "#f9e1e2"
  green: "#0a7d43"
  green-tint: "#dcefe3"
  amber: "#b07a00"
  amber-ink: "#7a5300"
  band: "#14181c"
  band-ink: "#f3f5f4"
  band-muted: "#c4ccc8"
  band-rule: "#3a434a"
  band-amber: "#e6a100"
  ground-dark: "#0e1215"
  surface-dark: "#161b1f"
  ink-dark: "#e8ecea"
  muted-dark: "#a5afb5"
  rule-dark: "#2e373d"
  cobalt-dark: "#7e9fff"
  red-dark: "#ff6f76"
  green-dark: "#45c987"
  amber-dark: "#e6a100"
  amber-ink-dark: "#f0b93a"
  rule-strong-dark: "#c9cfcc"
  cobalt-tint-dark: "#1a2547"
  red-tint-dark: "#3a1b1e"
  green-tint-dark: "#12301f"
  band-dark: "#1b2226"
  band-ink-dark: "#e8ecea"
  band-muted-dark: "#b3bcc1"
typography:
  display:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(34px, 5vw, 56px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  none: "0"
  mark: "2px"
  full: "50%"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
  button-hover:
    backgroundColor: "{colors.cobalt-tint}"
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "4px 7px"
  summary-cell:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    padding: "8px 10px"
  summary-cell-selected:
    backgroundColor: "{colors.surface}"
  limits-band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-ink}"
    padding: "24px 32px"
  record-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  nav-link-active:
    textColor: "{colors.ink}"
---

# Design System: DevLens

## Overview

**Creative North Star: "The Transit Line"**

The session is a metro diagram you ride. Stations are events. The fail, fix, pass route is the one thick cobalt line. The separate re-run is its own amber line, joined at a transfer. The whole system follows Swiss metro-diagram discipline: cool enamel ground, ink text, flat colour, ruled edges, route and rule lines at 0, 45 and 90 degrees only. Hierarchy comes from scale and weight, not from boxes.

The mood is calm, exact and civic. It is the opposite of a scoring dashboard. The summary band shows no ratios, percentages or gauges. Most cells are counts linked to the events they count, and the recording-time cell is a clock range linked to its first failure and first pass. The separate re-run cell is a status word (passed, failed, unknown or none) linked to the re-run event. The questions-answered and coding-agent-usage cells are counts with no events: they link to the questions and usage sections of the page. The usage context shows plain counts and dollar prices that do not link to events, and the player note shows frame and box dimensions. No verdict on the developer.

**Key Characteristics:**
- One reserved route colour (cobalt) that never edits evidence.
- State is always a colour plus a word (a label, status text or legend key). Marks on the line, strip, tables and chips add a shape.
- Flat everywhere: no shadows, no gradients, no rounded cards.
- Superseded stations stay on the line and carry a stamp.
- The limits (unknowns, not captured) stay visible: a dark band at the foot and a pinned strip on wide screens.
- Light and dark schemes follow the OS setting.

## Colors

A cool grey-green ground, near-black ink, and four signal colours that each own one meaning. Light values are normative in the frontmatter; the `-dark` tokens replace them under `prefers-color-scheme: dark`. `band-rule` and `band-amber` keep their light values in dark mode.

### Primary
- **Session Cobalt** (`cobalt`): the session line, the route line, links, focus rings, the active nav underline, the primary button, prompt and edit stations.

### Secondary
- **Signal Red** (`red`): failed-test stations, failed counts, deleted diff lines (as `red-tint`) and the recording state and live dot.
- **Terminus Green** (`green`): the passing terminus, passed counts, added diff lines (as `green-tint`) and the uploaded mark.
- **Re-run Amber** (`amber`, with `amber-ink` for text): the separate re-run line, its station and its table rows. `band-amber` is the same family used on the dark band for unknowns.

### Neutral
- **Enamel Ground** (`ground`): page background.
- **Paper** (`surface`): selected cells, chips, buttons, stamps.
- **Ink** (`ink`): text, strong rules, selected-station ring.
- **Slate** (`muted`): secondary text, captions, unknown marks.
- **Hairline** (`rule`): row and band dividers. `rule-strong` (ink in light mode, the rule-strong-dark value in dark) is for heavy rules at section heads and the top bar.
- **Tints** (`cobalt-tint`, `red-tint`, `green-tint`): selected-row and soft-state fills.
- **Limits Band** (`band`, `band-ink`, `band-muted`, `band-rule`): the dark strip for unknowns, not-captured and usage.

### Named Rules
**The Reserved Route Rule.** Cobalt marks the route and the way to act. It never recolours evidence such as test output, diffs or the developer's answer. The one evidence tint is the diff: added lines take `green-tint` and deleted lines take `red-tint`, which classify the text and are not a judgment.

**The Meaning Rule.** On the line, in counts and in status marks, red means failed, green means passed and amber means re-run. Do not use them as decoration or as a rank. Named exceptions: diff lines use the red and green tints for deleted and added text, and the recorder uses red for the recording state and live dot and green for the uploaded mark, with cobalt for the live run line.

**The Shape Beside Colour Rule.** Colour never carries state alone. Pair it with a word, and with a marker shape wherever the state is drawn as a mark.

## Typography

**Display and Body Font:** Hanken Grotesk (weights 400 to 800, with Helvetica Neue, Helvetica, Arial)
**Mono Font:** system monospace (ui-monospace, SF Mono, Menlo, Consolas)

**Character:** One workhorse grotesk at fixed sizes. Heavy 800 weight with tight tracking for headings, plain 400 for reading, tabular numbers on body text and what inherits it so times and counts align (buttons and chips set their own font shorthand and do not carry them).

### Hierarchy
- **Display** (800, clamp(34px, 5vw, 56px), 1.02): home hero heading only. Max 20ch.
- **Headline** (800, 30px, 1.15): the developer's verbatim answer, shown in quotation marks. The station title in the evidence panel is 26px, 800, 1.1. At 720px and below the answer drops to 26px and the station title to 20px.
- **Title** (800, 20px): replay page title and band headings. The record page title is 26px.
- **Body** (400, 14px, 1.45): running text. Lede text is 16px. Notes cap at 72ch, prompts and questions at 62ch.
- **Label** (700, 11px, uppercase): column headers and the activity-strip caption (0.08em tracking, column headers 0.06em on mobile), and the evidence-panel heading (0.09em). Limits headings are the exception at 12px, 800, 0.1em. A label names the thing it sits on; it is not a lead-in above another heading.
- **Mono:** test output and diffs are 12px at 1.55; assertions are 14px, 600, 1.35; ids and citations are 11px (ids at 1.4).

### Named Rules
**The Fixed Size Rule.** The base scale is 11, 12, 14, 16, 20, 26 and 30 px; size steps carry hierarchy. The build ships these named exceptions, and new surfaces should prefer the base scale: 13px (nav links, buttons, station titles on the line, table body), 19px (wordmark), 15px (passing-station title), 11.5px (chips), 10.5px (SUPERSEDED stamp), 12px uppercase 800 (limits headings) and the fluid hero (34 to 56 px).

## Layout

A single full-width column with a 32px gutter (16px at 720px and below). Bands stack with 24px vertical padding and a hairline divider. Spacing is a 4px-based scale: 4, 8, 12, 16, 24, 32, 48, 64.

Replay reads top to bottom: top bar, session summary band, line diagram corridor, lower band, limits band, tables and questions, pinned limits strip. The lower band is two columns (video and activity strip at 1.3fr, station evidence at 1fr, 48px gap). The evidence column hangs from a 2px ink rule on its left edge.

Breakpoints: the horizontal diagram swaps for a vertical one at 1040px and below; the lower band and chain grid collapse at 1100px and below; the pinned limits strip shows from 1000px and a static strip replaces it below; the mobile layout starts at 720px (tables reflow, top bar hides the take label, nav links reach a 44px minimum height; other controls such as activity ticks stay small). Home is capped at 1100px and record at 880px.

## Elevation & Depth

Flat. There are no shadows, no gradients and no blur. Depth comes from heavy ink rules (2px) against hairlines (1px), from tonal steps between ground and paper, and from the dark limits band. Positioned overlays are limited to the selected or focused station ring (a stroke), the activity-strip playhead, the small recording tag on the video, the skip link and the sticky pinned limits strip; none uses a shadow.

### Named Rules
**The Flat Enamel Rule.** Nothing is raised: no shadow, blur or gradient lifts anything off the page. Selection is a stroke, a top bar of cobalt, or a tint fill.

## Shapes

Square corners, with one 2px exception: the re-run mark. The only curves are circles that mean something: stations, the terminus, the developer chip marker, the passed marker. Strokes are mitred and butt-capped; route diagonals run at 45 degrees only. The glyphs inside markers, such as the passed check mark, are not bound by that rule.

Station marks (shape carries kind): prompt is a square, edit is a diamond, failed is a ringed circle with a cross, passed is a filled disc inside a terminus ring, re-run is a small square with a 2px corner, unknown is a dashed circle. Line weights: session 6, route 14, re-run 6 (compact diagram: 4, 9, 4).

## Components

### Buttons
- **Shape:** square, 1.5px ink border, 10px 14px padding, 13px 600 weight.
- **Default:** paper fill, ink text. Hover fills with cobalt tint.
- **Primary:** cobalt fill and border, white text (dark text in dark mode). Hover turns ink.
- **Disabled:** transparent, slate text, hairline border.
- **Link button:** cobalt underlined text, 1.5px underline, ink on hover.
- **Motion:** colour change only, 160ms, and only when reduced motion is not requested.

### Provenance chips
A marker shape plus a word, 1.5px ink border, paper fill. Observed is a filled ink square. Rule is a cobalt diamond. Re-run is an amber bar. Developer is a ring. Unknown has a dashed border and a dashed marker.

### Top bar
Wordmark (a tiny cobalt line with a hollow start and green end), then nav links (13px, 600, slate). The current page is ink with a 4px cobalt underline. A 2px ink rule closes the bar. A "later" tag marks the unbuilt Scenarios entry.

### Summary band
A row of cells under a 2px ink rule. Each cell has a 64px minimum height that stretches to the row; at 720px and below the minimum is removed and padding drops to 6px 8px. Each cell has a short label, a bold value and an optional note. Cells with events are buttons that filter the line (a cell with no events is disabled); the questions and usage cells are links to page sections; a pressed cell gets a 4px cobalt top bar and a paper fill. Failed values are red, passed are green, the re-run status word is amber-ink, section-link values are cobalt.

### Transit line diagram
The signature component. An SVG with a session line, a thick route line, an amber re-run line and a hollow transfer circle. Stations are clickable, keyboard reachable buttons. Selected stations get an ink ring; focus gets a dashed cobalt ring. When a filter is on, the line drops to 45% opacity and the marker shapes of unmarked stations drop to 35%; their titles and times turn slate, and rings and stamps stay opaque. A superseded station keeps its place and gets a boxed SUPERSEDED stamp. The vertical variant (up to 420px wide) serves narrow screens.

### Activity strip
Lanes of small event ticks over a time axis, with a 2px ink playhead. Ticks reuse the station shapes in miniature.

### Evidence panel
Title (26px), where-line, then blocks for assertion, result, diff, rule links, question and the verbatim answer. Diff lines tint only by add or delete. The answer is set large in quotation marks and is never edited.

### Tables
Collapsed borders, hairline row dividers, a label-style header over a 2px ink rule. The selected row takes cobalt tint. A re-run row starts with a 2px dashed amber rule. Narrow screens reflow rows into stacked label and value pairs.

### Limits band
A full-bleed dark band. Unknowns use amber squares, not-captured items use hollow squares, and a usage line closes it. A pinned copy sticks to the foot of the viewport from 1000px.

### Record state
A bordered, uppercase state badge. While recording it turns red with a thicker border. Consent text stays in plain body type.

## Do's and Don'ts

### Do:
- **Do** keep each summary-band cell one of three kinds: a count or a time linked to the events it counts (the re-run cell shows a status word, linked to the re-run event), or a count with no events that links to a page section. Never a ratio or percentage.
- **Do** pair every state colour with a word, and with a marker shape wherever the state is drawn as a mark.
- **Do** keep superseded stations on the line with a stamp.
- **Do** keep the "No score" statement and the limits band visible.
- **Do** label what is observed, rule-derived, re-run or said by the developer with the provenance chips.
- **Do** use the 4px spacing scale and the base type sizes, with the named exceptions only where the build already uses them.

### Don't:
- **Don't** show a score, rank, ratio, percentage, gauge or hire verdict. No verdict on the developer.
- **Don't** add shadows, gradients, blur or rounded cards.
- **Don't** draw route or rule lines at angles other than 0, 45 and 90 degrees.
- **Don't** use cobalt, red, green or amber to edit or soften evidence. Only diff lines carry a red or green tint.
- **Don't** hide the limits or the not-captured list.
- **Don't** use a log list beside a video as the main structure; the line is the structure.
