---
kind: plan
title: DevLens Review Questions (Option C, post-hackathon)
status: draft, not approved
updated: 2026-10-27
---
Summary: An evidence-backed review companion. It notices technology and design choices while the developer builds, asks why and which alternatives they weighed, stores the answers verbatim, and links them to the code and tests across sessions. Rules decide first. A typed decision model (TypeSafe Jev or OpenAI Decisions API) decides only where a rule cannot. Nothing scores or ranks a person.

Starts after the 2026-10-29 submission. The Thursday scope is A + H1a + H1b and is unchanged.

## User decisions (2026-10-27)
| Decision | Choice |
|---|---|
| Name | Review Questions, an evidence-backed review companion |
| Competence and cross-person | Evidence profile per developer. Distributions only. No score, no rank. NOT-1 stays. |
| Question timing | Live, at agent pauses (after a Claude Code `Stop`), in a DevLens panel. Never in the agent's context. |
| Question style | "Why React? Which alternatives did you consider, for example Vue or Angular?" |
| Decision engine | Explore TypeSafe Jev and OpenAI Decisions API instead of a generative LLM |
| Budget | Claude $100 is the Max monthly API credit (expires each cycle). OpenAI $100 is non-recurring. |
| Hook adapter manifest source (2026-10-27) | At each `Stop`, the adapter reads `package.json` and `requirements.txt` content itself, because capture stores only diffs. Before = the content seen at the previous `Stop`, or git `HEAD` at the first `Stop`. After = the working tree. Git is a second data source. Approved by Uma. |
| Wiring order (2026-10-27) | The hook adapter (C2c) is built now, rules only, with no UI. The `/record` answer panel and the app wiring wait for the redesign commit, then ship together. |
| Question source (2026-10-27, CR-7) | The DevLens Agent decides when and what to ask from what the developer builds. It replaces the catalog as the source. The C1/C2 rules stay in the code. |
| Delivery (2026-10-27) | A 10-second pop-up, then the question queue. Never blocks work. |
| Agent data (2026-10-27) | Session events plus repo files, read-only. No secret files, no edits, no shell. |
| Agent engine (2026-10-27) | Claude Code login (`claude -p`) by default; the Anthropic API when `ANTHROPIC_API_KEY` is set. No retry, no fallback on failure. |
| Overnight scope (2026-10-27) | Design, then build off by default. Local commits approved, no push. Fix the multi-line capture diff tonight. |

## What it does
1. **Detect a choice** (deterministic). It parses manifest and config diffs: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`, `Dockerfile`, `vite.config.*`, `next.config.*`, `angular.json`. It also reads the imports of new files. Filenames alone never trigger a question.
2. **Classify it** with a typed catalog: package → category → peer options. Peers come only from the same category.
3. **Ask** at the next agent pause: "You added `react` for the UI. Why React? Which alternatives did you consider, for example Vue or Angular?"
4. **Store** the answer verbatim, linked to the diff and the triggering events.
5. **Follow up** at most once. The follow-up fires when the answer names something a later diff shows, or when a typed decision says the answer names no trade-off.
6. **Track over sessions.** A per-project decision log keeps each choice, its question, the answer, and later evidence. A later switch (Vue to React) is a `supersedes` edge on the decision.
7. **Verify** with the existing sandbox re-run, and add a question when the re-run disagrees.
8. **Report** an evidence profile: decisions explained, unanswered questions, checks observed after edits. These are counts with citations, not grades.

## Technology catalog (excerpt, typed, versioned)
| Category | Options | Detected from |
|---|---|---|
| UI framework | React, Vue, Angular, Svelte, Solid | `dependencies` in `package.json` |
| Meta-framework | Next.js, Nuxt, SvelteKit, Remix, Astro | `dependencies`, config file |
| Backend language | Python, TypeScript/Node.js, Go, Java, Rust, Ruby | first manifest in a backend folder |
| Python web framework | FastAPI, Flask, Django | `requirements.txt`, `pyproject.toml` |
| Node web framework | Express, Fastify, NestJS, Hono | `dependencies` |
| Database | PostgreSQL, MySQL, SQLite, MongoDB, Supabase | driver package, `docker-compose` |
| ORM | Prisma, Drizzle, SQLAlchemy, TypeORM | `dependencies` |
| Test framework | Vitest, Jest, node:test, pytest | `devDependencies`, config |
| State management | Redux, Zustand, Jotai, Pinia | `dependencies` |

Rules:
- Never compare across categories. "React vs Node.js" mixes a UI library and a runtime, so it is never asked.
- "For example" shows the alternatives are examples. It does not imply the developer should have used one.

## Where decisions are made
| Decision | Engine | Why |
|---|---|---|
| A dependency was added, a category was matched, the peer list | Rules and the catalog | Exact and free |
| Dedupe, caps, cooldown, the live slot | Rules (state machine in the exploration plan, section 6) | Must be predictable |
| "Is this edit an architectural change?" (new folder layer, new service, new data store) | Typed decision: **Choice** | No reliable rule exists |
| "Does the answer name a trade-off or constraint?" | Typed decision: **Noul** (0–1) | Decides whether to send the one follow-up |
| "Is this question relevant to the cited evidence?" | Typed decision: **Choice** (relevant, weak, unrelated). Never a Score about a person. | Suppresses weak questions |
| Question wording | Template. Generative phrasing only if a blinded test wins. | — |

### Typed decision adapters
One `DecisionPort` interface with three adapters:
- `rules`: the default. Returns "unknown" when no rule applies.
- `jev`: TypeSafe Jev, `POST https://api.typesafe.ai/v1/systemone`, SDK `@typesafe-ai/sdk`, key `TYPESAFE_API_KEY`. Question types: Choice, Score, Noul.
- `openai-decisions`: OpenAI Decisions API (a specialized GPT-6 Luna).

Test fixtures replay recorded responses, so tests make no network calls.

| | Jev | OpenAI Decisions |
|---|---|---|
| Output | Typed choice or score or noul, with probabilities and confidence | Typed predicates, choices, scores |
| Price (secondary source, verify) | $0.042 per MTok input | $0.10 per MTok input, output and cache not charged |
| Cost per decision (1,500 input tokens) | $0.000063 | $0.00015 |
| Status (secondary source) | Opened 2026-09-15, text only | Public beta 2026-10-06, text and images |
| Budget it draws on | New TypeSafe account | Scarce OpenAI credit; spends very little |
| Unknown | Retention, privacy, rate limits, offline | Same, plus whether it is GA on this account |

Budget: 20 decisions per 60-minute session × $0.00015 = $0.003. Engine choice is not driven by cost. Choose it by retention terms and accuracy on our labels (experiment C-E2).

Guard rails:
- Default off. Requires opt-in, the budget guard and ledger, `maxRetries: 0`, and no automatic fallback.
- Send redacted excerpts only.
- Below a confidence threshold, the result is treated as "unknown" and falls back to the rule result.
- A typed decision never creates an edge. It only gates whether a question is asked. Its label in the report is "model classification".

## Evidence profile (per developer, opt-in)
- Decisions explained: a list of choices, each with its question, answer, and diff links.
- Questions unanswered or skipped: a count and a list. No penalty wording.
- Checks observed: tests run after agent edits, sandbox agreement. Counts with citations.
- Changes of decision: from the `supersedes` edges.
- Not shown: any score, rank, level, trait, "understood", or comparison with a named person.

## Cross-person view
- Same task, same acceptance tests, same model pin only.
- Aggregate distributions, shown only when n ≥ 5 opted-in people.
- No per-person rows and no sorting by person.
- Labeled exploratory.

## Phases
| Phase | Scope | Acceptance |
|---|---|---|
| C1 | Catalog plus manifest-diff detector for `package.json` and `requirements.txt`. One question template. Answer panel on `/record`. `answer` events. Rules only. | Fixture tests: adding `react` asks one question naming Vue and Angular; adding `react-dom` after `react` asks nothing (dedupe); adding a `devDependencies` test tool asks the test-framework question; a negative control with no new dependency asks nothing. One real consented take, verified by a different session. |
| C2 | Live slot at `Stop`, caps, cooldown, follow-up via term match | Integration test with a fake hook stream. At most 3 live questions per 30 minutes. Experiment E5 silence = 100%. |
| C2c | Hook adapter: captured events to `LiveInput`. At each `Stop` it flushes edits as a `diff` input, detects manifest choices, then emits `questions` and `stop`. `SessionEnd` emits `session_end`. Git reader for manifest content. No UI, not wired. | Fixture tests with a fake reader feed `step()`: a `react` add asks one question at a `Stop`; `react-dom` next asks nothing; no manifest edit asks nothing; `SessionEnd` gives `session_end`. A real temp git repo test of the reader. Reviewed by a different model family. |
| C3 | `DecisionPort` with Jev and OpenAI adapters, behind the guard, fixtures first | Experiment C-E2: on ≥ 100 labeled edits and answers, typed decisions beat rules-only F1 by ≥ 0.1, with 0 edges written. Ledger < $0.50. |
| C4 | Multi-session decision log and the evidence profile | Seven-day fixture labeled synthetic (NOT-4). Every profile line cites ids. No banned words in the page source. |
| C5 | Cross-person distributions | n ≥ 5 opted-in people. Counsel review done first. |

## Experiments
- **C-E1. Detector precision.** On 20 real repos, a choice question fires only on a real choice. Target precision ≥ 0.95.
- **C-E2. Typed decisions vs rules.** 2 human raters label "architectural change?" and "names a trade-off?". Require κ ≥ 0.6. Compare Jev, OpenAI Decisions, and rules-only.
- **C-E3. Thought-process value.** Reviewers read answers next to evidence vs the raw transcript. They must prefer the answers 4 of 5 times.
- **C-E4. Interruptions.** Disruption rating ≤ 3 of 5.

## Risks and open items
- Jev and OpenAI Decisions facts come from secondary news (pillitteri.it, Dealroom) and the TypeSafe docs. Verify price, retention, and terms on each provider's own page before any key is created.
- Code excerpts leave the machine with a hosted decision API. Each excerpt needs consent scope `decision_api`.
- Live questions change the work (observer effect). Every live answer is labeled with its time.
- Before C5 or any hiring use, counsel must review: NYC LL144, Colorado, California, Illinois, EU AI Act Annex III, FCRA, and monitoring-notice laws.
- Contract change needed after the fair: REQ-24, NOT-7, NOT-8, NOT-9, DEC-13, DEC-14 (exploration plan appendix), plus the catalog and DecisionPort.
