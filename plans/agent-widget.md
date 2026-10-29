---
kind: plan
title: DevLens Agent widget, /record redesign, recruiter updates (CR-8, CR-9)
status: built, video recorded; waiting on the user to watch
updated: 2026-10-28
---
Summary: DevLens runs as a background agent: a bottom-right widget for questions and notices, a redesigned /record setup page, and fact-only updates to a recruiter, ending in a new full-stack demo video.
Goal: A question pops up bottom-right for 10 s, then shrinks to a pill that always shows how many questions wait; the developer answers in the widget.
Intent: "the agent application window should be a pop up on bottom right when the question needs to be asked and wait for 10 sec and go back to queue. But Developer has to know there are questions in queue. it should look like an agent working in the background rather than a application"
Intent 2: "full screen should be allotted to developer to work easily ... Intermittently it should send project updates to recruiter and also when recruiter asked it should send status on demand"
Not wanted: an app window or Dock icon · a pop-up that steals keyboard focus · a second answer screen on /record · a score, rank, or verdict in any recruiter update · DevLens windows taking the developer's screen
Models: Claude only until the weekly reset (Fri 2026-10-30 00:00), per the user
Why now: Antler Agents track submission · freeze Thursday 2026-10-29 noon Central
Rules: agent stays off by default · `npm run demo` unchanged · no new npm packages · local commits only, no push · review in a different session

## Loop
1. Approve the plan and the recruiter decisions · user
2. Build slices 1, 2, 3b, 4 in parallel (disjoint files) · Claude (opus/medium), Claude (opus/medium), Claude (opus/medium), Claude (sonnet/medium)
3. Review each slice in a different session · Claude (sonnet/medium)
4. Integrate, wire the recorder, record the new video · Claude
5. Watch the video · user

## Requirements
| ID | Requirement | Source |
|---|---|---|
| REQ-27 | When the agent asks a question, a small pop-up appears at the bottom-right of the screen, above other apps, for 10 seconds. Then it returns to the queue. | user |
| REQ-28 | The developer can always see that questions are waiting: a small pill at the bottom-right shows the count, for example "DevLens · 2 questions". | user |
| REQ-29 | It looks like an agent working in the background, not an application: no Dock icon, no app menu, no normal window. | user (details: agent) |
| REQ-30 | The developer answers or skips in the widget: clicking the pill opens the queue. `/record` keeps only the agent on/off switch and one line, "N questions waiting · open the widget". | user (chosen option) |
| REQ-31 | One command starts the widget: `npm run widget`. It loads the widget page from the running DevLens server. | agent |
| REQ-32 | With nothing waiting, the pill reads "DevLens · watching". If the server cannot be reached, it reads "DevLens · offline". With the agent off, the widget shows nothing. | agent |
| REQ-33 | A new demo video shows the widget: Claude Code at work, the pop-up, the pill count, and answers typed in the widget. | user (chosen option) |
| REQ-34 | The developer gets the full screen while working. No DevLens browser window is needed during work; only the widget shows. | user |
| REQ-35 | `/record` is a setup page with two capture rows: "Session log" (on through the hooks, project name, live event count) and "Screen video" (off until a click). The state is the page lead with an elapsed clock and a tab-title cue. Consent text sits beside the buttons. Uploaded and error states give a next step. | user (critique, all 5 issues) |
| REQ-36 | When sharing is on, DevLens sends the recruiter a project update from time to time: after a Claude Code Stop with new developer prompts, at most once per `DEVLENS_UPDATE_EVERY_MIN` minutes (default 10). | user |
| REQ-37 | The recruiter can click "Request status" on `/recruiter` and gets a status reply within 10 seconds. | user |
| REQ-38 | Every update line is a fact built by fixed rules from the session log (prompts, files changed, test results, agent questions answered) and links to its event ids. | user |
| REQ-39 | Sharing is one opt-in switch on `/record`, off by default. Each update or status reply also shows briefly in the widget, for example "Sent update to recruiter". | user |
| REQ-40 | The demo uses a new, larger full-stack project (API, SQLite database, browser UI, tests) built with Node built-ins, so it needs no package install. | user (stack: agent) |
| NOT-12 | A recruiter update never holds a score, rank, ratio, or verdict written by DevLens, and never holds code, diffs, or file contents. It shows each developer prompt word for word (secrets redacted, up to 2000 characters, at most 20 per entry), labelled as the developer's words (CR-10). | agent, changed by user 2026-10-28 |
| NOT-11 | The pop-up never takes keyboard focus and never plays a sound. Focus moves to the widget only when the developer clicks it. | agent (from CR-7 "don't disturb") |

## Decisions
| ID | Decision | By |
|---|---|---|
| DEC-16 | Native macOS floating panel built with the system Swift compiler (`swiftc`, no package install). It hosts a web view of `http://localhost:3100/agent`, so the widget reuses `createAgentQueue` and `/api/agent`. | user (surface), agent (build) |
| DEC-17 | Ship before the Thursday noon freeze, then record a new video. The current video stays as the fallback. | user |
| DEC-18 | `/record` keeps only the switch and the waiting line. Its pop-up and queue move to the widget. | user |
| DEC-19 | Page-to-panel protocol: the page posts `{type:'mode', mode:'hidden'\|'pill'\|'popup'\|'queue', width, height}` to `window.webkit.messageHandlers.devlens`. The panel resizes itself, keeping its bottom-right corner fixed. | agent |
| DEC-20 | Demo automation only: `npm run widget -- --automation` makes the panel run each stdin line as page JavaScript. Without the flag, stdin is ignored. | agent |

| DEC-21 | Recruiter channel: a local `/recruiter` page. A hosted link through Supabase comes later. | user |
| DEC-22 | Update content: facts from events by fixed rules, no model. | user |
| DEC-23 | Consent: one opt-in (`.devlens/share.json` `{"enabled":true}`); every send is shown in the widget. | user |
| DEC-24 | Demo app: a new project in `~/Code-Git-Repos/devlens-fullstack-demo`, using Node's `node:http`, `node:sqlite`, `node:test`, and a no-build browser UI. | user (project), agent (stack) |
| DEC-25 | Recruiter API: `GET /api/recruiter` returns `{sharing, project, updates}`. `POST {type:'share', enabled}` sets the opt-in. `POST {type:'request_status'}` appends and returns a status entry. Entry shape: `{id, kind:'update'\|'status', ts, since, lines:[{text, cites}]}`. Storage: `.devlens/recruiter.jsonl`, append-only. | agent |
| DEC-26 | Claude only for builds and reviews until the weekly reset. | user |

## Evals
| ID | REQ | Check | Method | Result |
|---|---|---|---|---|
| EVAL-26 | REQ-27, REQ-28, REQ-32 | `npm run test:widget`: a new question gives mode `popup` for 10 s, then `pill` with the open count; answer and skip lower the count; the idle pill says "watching"; a failed fetch says "offline"; agent off gives `hidden`. Every mode change posts one DEC-19 message. | unit | pass (2026-10-28, test:widget 14/14, commit b3c4691) |
| EVAL-27 | REQ-30 | `npm run test:record`: with the agent on, `/record` shows the switch and "N questions waiting · open the widget", and renders no pop-up and no queue. With the agent off, `/record` renders as before. | unit | pass (2026-10-28, test:record 61/61) |
| EVAL-28 | REQ-29, REQ-31, DEC-16 | `npm run widget:build` compiles with exit 0. The built app sets an accessory activation policy and a non-activating floating panel (grep the source). | build + verifier diff | pass (2026-10-28, widget:build exit 0; grep shows .accessory, .nonactivatingPanel, .floating, hasShadow = false) |
| EVAL-29 | REQ-27, REQ-28, REQ-29 | Live run with Terminal in front: a frame shows the pop-up bottom-right over Terminal; 10 s later a frame shows the pill with the count. No Dock icon appears. | screen frames | pass (2026-10-28, frames /tmp/devlens-int/frames and the take 2 video: pop-up bottom-right, then pill "1 question") |
| EVAL-30 | NOT-11 | During the live run, `lsappinfo front` names Terminal before, during, and after the pop-up. | integration | pass with a fix (2026-10-28): a pop-up never took focus (Terminal stayed front); launch took focus once, fixed in f13b2ab to hand it back |
| EVAL-31 | REQ-30 | After answering in the widget, an `answer` event with that text is in `.devlens/events.jsonl` and the pill count drops by one. | integration | pass (2026-10-28, live check: answer event written, count dropped; 3 answers in the take 2 run summary) |
| EVAL-33 | REQ-36, REQ-38, NOT-12 | `npm run test:recruiter`: with sharing on and the gap passed, a Stop appends one update whose lines cite real event ids; with sharing off, or inside the gap, nothing is appended; no DevLens-written line matches the score, rank, verdict, or fix filter; developer prompts appear verbatim and redacted (CR-10); no diff or file text appears. | unit | pass (2026-10-28, test:recruiter 37/37 after CR-10, test:capture 36/36) |
| EVAL-34 | REQ-37 | `npm run test:recruiter`: `POST request_status` returns a status entry built from the events so far, and it is appended once. | unit | pass (2026-10-28, test:recruiter; live status reply in the take 2 video) |
| EVAL-35 | REQ-35, REQ-39 | `npm run test:record`: the two capture rows, the state clock, the agent row, and the sharing switch render; with sharing off, no recruiter call is made. | unit | pass (2026-10-28, test:record 61/61) |
| EVAL-36 | REQ-34, REQ-40 | The new video shows the developer's work full screen, the widget, a recruiter update, and an on-demand status reply. | human | not run (the user watches devlens-demo-recorder/out/devlens-fullstack-demo-1793241546273.mp4) |
| EVAL-32 | REQ-33 | The new video plays to the end. Frames show the pop-up, the pill count, and a typed answer, plus the "Scripted demo" caption. | human | not run (the user watches the video) |

## Infrastructure
| Resource | Defined in | Applied by | Secrets |
|---|---|---|---|
| Widget page `/agent` | `apps/web/app/agent/page.tsx` | `next start` | none |
| Native panel | `apps/widget/DevLensWidget.swift` | `npm run widget:build` (`swiftc`) | none |
| Built widget binary | `.build/devlens-widget` (git-ignored) | `npm run widget` | none |

## Observability
| Signal | Seen in | Eval |
|---|---|---|
| Widget mode changes | `console.debug` in the page; panel stderr line `mode <name>` | EVAL-26, EVAL-29 |
| Server unreachable | pill text "DevLens · offline" | EVAL-26 |
| Answer saved | `answer` event in `.devlens/events.jsonl` | EVAL-31 |

## Slices
### Slice 1: widget page and /record switch
- Covers: REQ-28, REQ-30, REQ-32 (and the page half of REQ-27)
- Model: Claude (sonnet/medium); review Grok
- Depends on: none
- Files: `apps/web/app/agent/page.tsx` (new), `apps/web/agent/widget.tsx` (new), `apps/web/agent/widget.test.ts` (new), `apps/web/record/agent-queue.tsx`, `apps/web/record/agent-queue.test.ts`, `apps/web/record/page.tsx`, `apps/web/app/globals.css`, `package.json` (script `test:widget`)
- [x] Widget page with pill, pop-up, and queue modes, reusing `createAgentQueue` · Claude (sonnet/medium) · EVAL-26 · revert the slice commit
- [x] `/record` keeps the switch and the waiting line only · Claude (sonnet/medium) · EVAL-27 · revert the slice commit

### Slice 2: native floating panel
- Covers: REQ-29, REQ-31, NOT-11 (and the panel half of REQ-27)
- Model: Claude (opus/medium); review Grok
- Depends on: DEC-19 protocol only, so it runs in parallel with slice 1
- Files: `apps/widget/DevLensWidget.swift` (new), `apps/widget/README.md` (new), `package.json` (scripts `widget:build`, `widget`), `.gitignore`
- [x] Borderless, non-activating floating panel, on all Spaces, anchored bottom-right, transparent, accessory app (no Dock icon) · Claude (opus/medium) · EVAL-28 · revert the slice commit
- [x] Resize on DEC-19 messages; become key only on click; `--automation` stdin flag · Claude (opus/medium) · EVAL-28, EVAL-30 · revert the slice commit

### Slice 3: live check and new demo video
- Covers: REQ-33, EVAL-29 to EVAL-32
- Model: Claude (Tech Lead)
- Depends on: slices 1 and 2 reviewed
- Files: `devlens-demo-recorder/orchestrate.mjs` (outside this repo), `plans/devlens.contract.md` (CR-8 row and REQ-26 note)
- [x] Layout: caption strip at the top, Claude Code in Terminal full width, the widget floating bottom-right · Claude · EVAL-29, EVAL-30, EVAL-31 · keep the current video
- [x] Record and check the new take · Claude · EVAL-32 frames · keep the current video
- [ ] Watch the new video · user · plays to the end and reads well · use the current video

### Slice 3b: recruiter updates
- Covers: REQ-36, REQ-37, REQ-38, NOT-12, DEC-25
- Model: Claude (opus/medium); review Claude (sonnet/medium)
- Depends on: DEC-25 only
- Files: `packages/recruiter/` (new), `apps/web/api/recruiter/route.ts` (new), `apps/web/app/api/recruiter/route.ts` (new), `apps/web/recruiter/` (new), `apps/web/app/recruiter/page.tsx` (new), `packages/capture/hook.ts`, `packages/capture` tests
- [x] Update builder, Stop trigger, API, and `/recruiter` page · Claude (opus/medium) · EVAL-33, EVAL-34 · revert the slice commit

### Slice 4: full-stack demo project
- Covers: REQ-40
- Model: Claude (sonnet/medium)
- Depends on: none
- Files: `~/Code-Git-Repos/devlens-fullstack-demo/` (new, its own git repo)
- [x] App with API, SQLite, UI, tests, and one seeded bug; DevLens hooks installed · Claude (sonnet/medium) · `npm test` shows exactly the seeded failure · delete the folder

## Changes
| ID | Date | Change | Affects | Approved |
|---|---|---|---|---|
| CR-8 | 2026-10-28 | The pop-up and queue move from `/record` to a native floating widget at the bottom-right. `/record` keeps the switch and is redesigned (critique 21/40). | REQ-26, EVAL-25 | user approved in chat 2026-10-28 |
| CR-9 | 2026-10-28 | Recruiter updates: periodic and on-demand facts on a local `/recruiter` page, opt-in, shown in the widget. | REQ-36 to REQ-39, NOT-12 | user approved in chat 2026-10-28 |
| CR-10 | 2026-10-28 | The reviewer sees the developer's prompts: each update and status lists every developer prompt in its window, verbatim and redacted, instead of a 120-character excerpt. The sharing switch copy says so. | NOT-12, REQ-38, EVAL-33 | user asked in chat 2026-10-28 |

## Work
### Open
- Should the widget start by itself when the agent is turned on, instead of with `npm run widget`? Recommended: not before the freeze: unknown
- Exact pill and pop-up styling follows DESIGN.md (Transit Line) in slice 1; no separate design round before the freeze: unknown
