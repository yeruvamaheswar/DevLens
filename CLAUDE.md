# DevLens orchestration rules

These rules apply to the Tech Lead and to every agent that works in this repo. The product contract is `plans/devlens.contract.md`. The build plan is `plans/devlens-implementation.md`.

## Roles
- Claude is the permanent Tech Lead. Claude owns slice release, model choice, shared interfaces, review assignment, and integration.
- A builder never verifies its own slice. A different session reads the diff and runs the Verify commands.
- A worker does not launch other workers.

## Providers and usage limits
Subscriptions are tiers, not measured budgets. T3 does not show remaining usage. Label usage unknown and route conservatively.

| Provider | Plan | Use for |
|---|---|---|
| Claude | $100 (high tier) | Tech Lead work, and also builds and reviews. Use Sonnet 5.5 for builds, reviews, and anything needing live Supabase tools. Use Opus 5.5 for the hardest slices and final integration. |
| Codex | $20 | Bounded TypeScript, tests, deterministic rules, debugging |
| AGY | $20 | Mechanical work such as starter scenarios. Use Gemini Flash. |
| Cursor | $30 | Frontend, recorder, replay UI. Use model `default` (Auto). |
| Grok | $30 | Independent review and analysis of builds by other providers |

These are defaults. The Tech Lead picks the model per task and records the reason.

## Efficiency rules
1. Use the cheapest model and lowest effort that can do the task reliably. Do not default to high effort or to Opus.
2. There is no fixed cap on agents. The Tech Lead decides how many run, using the `subagent-budget` skill. Run parallel agents only for independent work with disjoint files and ready dependencies. Pick the model that best fits each task first. Load balance across providers only as a tie-breaker between equally fit models. On a fallback, move to the next-best fit, not to the provider that happens to be idle.
3. Use Claude freely for subagents: the plan has the headroom, so Claude is the primary builder and reviewer. The Tech Lead session itself also draws on Claude, so keep its own context small.
4. Review with a different session. Prefer a different model family than the builder.
5. Prefer a deterministic test over another model review when a test can prove the result.
6. Give each agent only the files and context its slice needs. Do not rebuild context that evidence already holds.
7. Fallback order when a provider fails through T3 (limit, 401, expired login): (1) run the same task through that provider's own CLI from the terminal; (2) only if the CLI also fails, move the slice to the next fit provider; (3) Claude is the last fallback. Terminal runs are non-interactive and background: `codex exec --sandbox workspace-write -C <repo> "<brief>"`, `cursor-agent -p`, and the `grok` CLI. The same Files list, no-commit and no-install rules apply, and a different session still verifies the result. Checked 2026-10-26: `codex exec` worked while T3's Codex route returned 401. After a failed check, raise one agent by one level or switch to its fallback provider. Try three times at most, then stop and ask the user.
8. If a provider reports a limit, switch to the slice's fallback and record it. Never invent usage numbers.
9. Never claim an agent launched when it did not. If T3 cannot dispatch a model, write a manual handoff.

## Safety rules
- No commit, push, merge, deploy, or package install without authorization. Local commits are authorized. Push is not.
- Keep keys out of chat, logs, docs, and Git. `.env` stays local and ignored.
- Use only the Supabase project `devlens` (ref `hivfaqlabtbrhrviwrrm`). Do not touch other projects.
- Do not edit files outside your slice's Files list.
- Product limits: no score, rank, or hire verdict. Claude Code is the only capture adapter. Screen recording needs explicit consent, with audio and camera off.

## Slice states
PLANNED, READY, IN_PROGRESS, BLOCKED, REVIEW, VERIFIED. A slice is VERIFIED only with recorded evidence from a different session.
