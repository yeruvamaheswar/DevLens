recorded take, 2026-10-27

This is a real take, not a synthetic fixture. The project author recorded their own Claude Code session on the `broken-api` task and consented to the recording. No other person appears in it.

## What it contains

- `session.jsonl`: 30 events from two Claude Code sessions, captured by project-local hooks with redaction before append.
- `session.webm`: one window recording of the terminal that ran Claude Code. Window mode only. The recorder requests no audio and no camera.
- `git-log.txt`: the commits of the temporary working copy: `starter`, `first-fix`, `final-fix`.

## What happened

1. Session 1: Claude ran `npm test`, changed the base URL from `/v0` to `/api`, and `npm test` still failed on `expected Authorization header`.
2. Session 2: Claude ran `npm test`, added a module-level `sessionToken` constant and the `Authorization` header, and `npm test` passed.
3. The `first-fix` and `final-fix` commits were made outside the recorded sessions, by a separate tooling session at the author's direction. Claude Code in the recorded sessions made no commits and edited only `src/client.js`.

The author's prompt asked Claude to run plain `npm test` every time, so the failed and the passed test share one command string.

## Known limits

- The home path `/Users/UmaYeruva` appears in `cwd` and `transcript_path` fields. It was accepted and not removed.
- Event 25 stores the `Authorization` line of an edit as `[REDACTED]`. The line is not a secret. The git diff holds the true edit.
- The WebM header reports 238x152, but nearly all frames are 2462x1582. Check playback before relying on the header.
- Claude Code collapses tool output on screen, so the failing assertions are clearest in the log, not in the video.
- `git-log.txt` shows the author's git name and email.

Independent review: `plans/slice-6-verify.md` (pass with findings, a different session than the recorder).
