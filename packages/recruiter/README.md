# Recruiter updates

Facts from the session log, built by fixed rules with no model. No score, rank, ratio, or verdict. No code, diffs, file contents, or tool output (NOT-12).

## Turn it on
Sharing is off by default. Turn it on with `POST /api/recruiter {"type":"share","enabled":true}`, which writes `.devlens/share.json` `{"enabled":true}`.

## When an update is sent
At a Claude Code Stop (`packages/capture/hook.ts`), an update is appended to `.devlens/recruiter.jsonl` when all are true:
- sharing is on;
- the gap since the last update has passed: `DEVLENS_UPDATE_EVERY_MIN` minutes (default 10, `0` means every eligible Stop);
- there is at least one new developer prompt since the last entry.

A failure prints one warning to stderr and never stops the hook or the agent.

## Line formats
Each line cites the event ids it rests on. A line that matches the agent's score, rank, hire, or fix filter is dropped.
- each developer prompt in the window, word for word with line breaks, secrets redacted, up to 2000 characters (`prompt: true`); at most 20, older ones as `and N earlier developer prompts`
- `Files changed: a.js, b.js` (file names only, up to 8, then `and N more`)
- `Tests: 1 failing → 4 passing` (first and last test in the window)
- `Agent questions: 2 asked, 2 answered` (`, 1 skipped` when any)
- `Last activity: <ISO time>` (status only)

## API and page
- `GET /api/recruiter` returns `{available, sharing, project, updates}`, newest first.
- `POST {"type":"request_status"}` appends a status for the whole latest session and returns it, or `409 {"error":"sharing_off"}`.
- `/recruiter` shows the feed, polls every 5 seconds, and has a "Request status" button.
- The server reads the project folder only from `DEVLENS_PROJECT_DIR`.

## Test
`npm run test:recruiter`
