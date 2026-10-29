# DevLens

DevLens is an evidence agent for a consented coding task. It turns one Claude Code session into a replay. A reviewer clicks a claim and sees the recording, the event, the code change, and the test result together.

The page does not score, rank, or recommend a hire. "Nothing here predicts job performance."

Hackathon: AITX and MLOps World Community Hackathon, Antler Agents track. Submission deadline: Thursday, 29 October 2026, 5:00 PM Central.

## What it does

1. Claude Code hooks append redacted events to a JSONL file.
2. A deterministic linker adds rule edges: `prompted`, `edited`, `ran_test`, `failed`, `supersedes`, `verifies`. Each edge names its rule and its evidence.
3. A separate sandbox re-run of the test is stored as its own event. It is never merged into the session's test line.
4. A window recording of the terminal is synced to the events by media offset.
5. The Replay page plays the recording. A click on "first failed test" or "passing test" seeks the video to that event.
6. Three questions come from fixed rules, with event ids. No model writes them. The page also lists unknowns and what was not captured.

The golden take is a real session. The author recorded their own Claude Code run on the `broken-api` task and consented. See [examples/broken-api/fixtures/golden/README.md](examples/broken-api/fixtures/golden/README.md).

## Quick start

Tested on Node 24. Node 22 or later should work but was not tested. Run from the repo root.

```
npm install
npm run demo -- --offline
```

Open `http://localhost:3000/replay`. If port 3000 is busy, Next picks another port and prints it. A leftover `next dev` for this repo also blocks a second one: stop it first. This mode needs no Supabase and no keys. The page label says `local fixture`.

To read from Supabase, run `npm run demo`. The label then says `supabase`. If the server keys are missing or a read fails, the page falls back to local files and shows a warning. `/replay?offline=1` forces local mode.

### Environment

Keep keys in the repo-root `.env`. It is ignored by Git. Never paste keys into chat, logs, or docs.

| Name | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Read access under row-level security |
| `SUPABASE_SECRET_KEY` | Server only. Signs short-lived media links. Never sent to the browser |
| `DEVLENS_RECORD_ENABLED` | Set to `1` to turn on the upload routes under `/api/recordings`. Off by default |
| `DEVLENS_OFFLINE` | Set by `npm run demo -- --offline` |
| `DEVLENS_PROJECT_DIR` | Optional. The folder Claude Code runs in. Needed for the question agent on `/record`. See [Question agent](#question-agent-opt-in) |
| `ANTHROPIC_API_KEY` | Optional. Switches the question agent from your Claude Code login to the Anthropic API. Read by the agent process only |

Only the Supabase project `hivfaqlabtbrhrviwrrm` is used. The `recordings` bucket is private.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Type check |
| `npm run demo:smoke` | Live checks: fixture, WebM header, Supabase read, insert denial, signed private media |
| `npm run demo:smoke -- --offline` | The same local checks. The live checks print SKIPPED |
| `npm run fixture:verify -- broken-api` | Checks the golden take: a failed test then a passing test with the same command, events inside the recording window, consent, one video track, no audio |
| `npm run scenario:verify -- --all-starters` | Checks that every starter fails with a real assertion in a temp copy |
| `npm run test:replay`, `test:link`, `test:rerun`, `test:sync`, `test:record`, `test:capture` | Unit tests per area |
| `npm run build && npm run check:bundle` | Builds the app and rejects the server key name in browser assets. `check:bundle` fails if any source file changed after the last build |
| `npm run test:agent` | Question agent core with fake engines and temp folders. No network |
| `npm run agent:smoke` | One real `claude -p` call on a synthetic fixture session. Uses your Claude Code login (or `ANTHROPIC_API_KEY`). Prints whether the question was kept or skipped |
| `npm run test:questions` | Review Questions C1 (post-hackathon, not in the app yet): technology catalog, manifest-diff detector, and question template. Rules only |
| `npm run test:journey` | Recruiter journey: stations, failure-to-fix chain, questions, and line layout over the golden take and synthetic events |
| `npm run test:t3` | T3 Code adapter (experimental): mapping, diff shapes, and the read-only store on a temp database |
| `npm run t3 -- list` / `import` / `verify` | T3 Code adapter commands. See [packages/t3/README.md](packages/t3/README.md) |

Link a session to a recording (writes to Supabase, so it needs the server key; `--dry-run` only counts):

```
npx tsx packages/cli/src/link.ts <events.jsonl> [--recording <meta.json>] [--rerun <rerun.jsonl>] [--dry-run]
```

## Question agent (opt-in)

Off by default. With it off, the Stop hook starts nothing and `/record` shows only one extra control, the `Question agent` toggle.

How it works: after a Claude Code `Stop`, the hook appends its event, then starts `packages/agent/src/cli.ts` in the background. The hook returns at once and prints nothing. The agent may ask at most one question about that task. The question goes into `.devlens/events.jsonl`. `/record` shows it as a pop-up for 10 seconds, then in a queue. You answer or skip later. Each answer or skip is appended as an `answer` event. The agent never scores, ranks, or gives a verdict.

Turn it on:

1. Set `DEVLENS_PROJECT_DIR` in the repo-root `.env` to the same folder Claude Code runs in (its `CLAUDE_PROJECT_DIR`). Restart `next dev`. With it unset, the toggle is disabled and the route writes nothing.
2. Open `/record` and click `Question agent`. This writes `.devlens/agent.json` as `{ "enabled": true }`. Only that exact value turns it on. A missing file, bad JSON, or `enabled: false` is off.

Engine routes (no retry, no fallback, no tools; at most 30 calls per session, 60 seconds each; model `claude-sonnet-5-5`):

| Route | When | Cost |
|---|---|---|
| Claude Code login | Default. Runs `claude -p` with no tools in an empty temp folder | Your Claude subscription |
| Anthropic API | `ANTHROPIC_API_KEY` is set and not blank | API billing on that key |

If a call fails or times out, no question is asked. The failure goes to `.devlens/agent-ledger.jsonl`. The ledger holds times, route, model, and result. It holds no prompt text.

What leaves the machine: one request per Stop to the engine you chose. It holds the last 200 session events, up to 500 repo file names, and the text of up to 8 touched files and manifests (`package.json`, `requirements.txt`, the first 4 KB of `README.md`). Secret paths (`.env*` except `.env.example`, `*.pem`, `*.key`, `.ssh/`) and files outside the project are never read. The whole prompt passes the capture redactor first.

## Recruiter journey

`/recruiter` opens with the development journey: a train line of the session's recorded events, in time order. Stations are prompts, grouped agent actions, code changes, test results, model switches, and unattributed changes. The separate re-run leaves the line as a branch. A click opens the evidence: the prompt word for word, the command and its output, the diff, the git checkpoint, the rule links with observed or inferred labels, and the provider ids. If the session has a recording, the click also seeks it.

Below the line, seven steps show the failure-to-fix chain: original failure, first fix, still failing, developer response, revised code, passing test, independent verification. A missing step is said in words, never filled in. Three questions come from fixed rules and cite event ids. The page shows unknowns and what was not captured.

Sources: the golden Claude Code take (verified), any imported T3 Code thread (experimental, local), and saved T3 captures in `examples/t3-captures/` (experimental, committed, so a hosted build shows them). Open a source directly with `/recruiter?source=golden`, `/recruiter?source=t3:<thread id>`, or `/recruiter?source=t3-saved:sprintboard-rehearsal`. The saved rehearsal is a real T3 session on SprintBoard whose prompts were written by an agent, and the page says so. The live updates feed from CR-9 is below the journey.

## Hosted demo (Vercel)

The Vercel project `devlens` builds `main` on every push with `npm run build` (output `apps/web/.next`) and `DEVLENS_OFFLINE=1`. It needs no secrets. Uploads stay off because `DEVLENS_RECORD_ENABLED` is unset. Every deployment requires a Vercel login with access to the team. The hosted site shows the golden take and the saved T3 captures only. Local T3 imports in `.devlens/` are not deployed.

## T3 Code adapter (experimental)

DevLens can read a T3 Code thread from the T3 server's local store, read-only, and show it on `/recruiter`. It works for any provider T3 runs (Claude, Codex, Cursor) and keeps the provider and model T3 recorded for each run. It is labelled experimental: the T3 store is internal to T3, and the adapter was checked only against T3 Code 0.1.3. Details, event mapping, and limits: [packages/t3/README.md](packages/t3/README.md). Demo steps: [plans/t3-integration.md](plans/t3-integration.md).

```
npm run t3 -- list --workspace ~/Code-Git-Repos/sprintboard-demo
npm run t3 -- import --thread <id>
npm run t3 -- verify --thread <id>
```

## Scenarios

Each starter has a failing test. Run `npm test` inside its directory.

| Directory | Failure |
|---|---|
| `examples/broken-api` | wrong base URL, then a missing Authorization header |
| `examples/swapped-field` | name and email swapped |
| `examples/missing-auth` | no Authorization header |
| `examples/stale-cache` | cache returns the old value after an update |
| `examples/wrong-page` | pagination asks for the wrong page |
| `examples/bad-date` | date parsing gives the wrong day |
| `examples/empty-list` | an empty result crashes |

Re-run a test in the sandbox with `npx tsx packages/cli/src/rerun.ts --dir <path> --command <command> --rerun-of <event-id> --session <id> --project <id> --out <file>`. The `--unsafe-no-isolation` flag turns the sandbox off. Do not use it on code you did not write.

To record your own take, follow [examples/broken-api/RECORDING.md](examples/broken-api/RECORDING.md).

## Recording

Saving a take to Supabase needs `DEVLENS_RECORD_ENABLED=1`. Nothing records until you click.

- **Record one window** is the default. You pick one window.
- **Record my desktop (second opt-in)** is separate. It shows its own notice, and the take is labeled `desktop`.
- Audio and camera are always off. The server refuses a take with audio, without consent, or with the wrong mode.
- You review the video, then choose Upload or Delete. Upload goes to private storage.

The desktop picker path is built and unit tested. It has not been checked by a person in a real browser. See [apps/web/record/README.md](apps/web/record/README.md).

## Known limits

Read these before trusting the demo.

- The golden take's hook log contains the author's home path (`/Users/UmaYeruva`) in `cwd` and `transcript_path`. It was accepted and not removed. `git-log.txt` shows the author's name and email.
- Claude Code collapses tool output on screen. At a seek point the video shows the terminal, but the failing or passing output may not be visible. The log text on the page is the evidence.
- The WebM header says 238 by 152, but nearly all frames are 2462 by 1582. The page sizes the player to the real frame.
- The `first-fix` and `final-fix` commits were made outside the recorded sessions. The page shows each diff as "from git, not from the hook log". It pairs a diff to hooked edits by session order and says that is an inference.
- The take has no recorded answer to a DevLens question. The page says so.
- `GET /api/replay` has no authentication. Anyone who can reach the server can read the golden events and mint a 30-minute link to the private recording. Run it locally or share it only on purpose. The author consented to this take.
- The link exposes one object, download only. `/api/replay/media` ignores any path in the request.
- Rule edges show `observed` (a separate sandbox re-run gave the same result) or `inferred` (event order only). Neither is a cause.

### Sandbox re-run limits

The re-run uses macOS `sandbox-exec`. It suits re-running the author's own reviewed task code, one session at a time. Details are in [plans/slice-5-verify3.md](plans/slice-5-verify3.md).

DevLens does **not** claim:

- containment of hostile code
- a defense against sandbox escape on macOS
- hidden temp directory names, `/etc`, or file metadata (these stay readable)
- that every child process is killed (a `setsid` or detached child survived a test)
- cross-platform isolation
- atomic writes across several sessions (one session is atomic)
- a live test of the authenticated Supabase role

It does show that a normal command ran in the sandbox and returned `passed`, and that the tested secrets and the tested listener were not reached.

## Layout

| Path | Contents |
|---|---|
| `apps/web` | Next.js app: `/replay`, `/record`, `/recruiter`, `/api/replay`, `/api/journey`, `/api/recordings` |
| `packages/capture` | Claude Code hook handler and redaction |
| `packages/t3` | T3 Code adapter (experimental): read-only reader, mapper, import, verify |
| `apps/web/journey` | Provider-neutral journey builder, line layout, and evidence panel for `/recruiter` |
| `packages/link` | Rules, edges, and the sandbox re-run |
| `packages/cli` | `init` (installs project-local hooks), `link`, `rerun` |
| `packages/core` | Event contract, Supabase access, demo and smoke scripts |
| `examples` | Seven starter tasks. `broken-api/fixtures/golden` holds the golden take |
| `supabase/migrations` | Schema. Apply only to project `hivfaqlabtbrhrviwrrm` |
| `plans` | Contract, plan, and the independent review notes per slice |

Contract: [plans/devlens.contract.md](plans/devlens.contract.md). Plan: [plans/devlens-implementation.md](plans/devlens-implementation.md). Competitors: [docs/competitors.md](docs/competitors.md).

## Product limits

No score, rank, or hire verdict. Claude Code hooks are the verified capture adapter. The T3 Code adapter is experimental and read-only. Screen recording needs explicit consent, with audio and camera off.

## After the fair

- A virtual desktop the developer can download and install tools on.
- The same evidence model over a week-long project.

## Stack

TypeScript CLI, Supabase Postgres and Storage, and a Next.js 16 app.
