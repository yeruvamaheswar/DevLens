# Submission checklist

Deadline: Thursday 2026-10-29, 5:00 PM Central. Freeze: noon. Only you can do the steps marked **You**.

## Before you record the Loom

1. **You.** Stop any leftover dev server: `lsof -iTCP:3000 -sTCP:LISTEN`, then `kill <pid>`. A stale `next dev` on port 3000 (started 10:56 on 2026-10-27) shares `.next` with `npm run build`, so restart it.
2. Run `npm run demo` from the repo root. Open the URL Next prints, then `/replay`. The label should say `supabase`. If it says `local fixture`, check `.env` (names are in the README).
3. Fallback if the network fails: `npm run demo -- --offline`.
4. Click "Open the first failed test" and "Seek to the passing test". The video should show the terminal at about 30.4 s and 177.9 s.

## Loom (2 to 5 minutes) — You

Suggested order:

1. The problem: a reviewer cannot see how a coding task was solved.
2. The Replay page: click the failed test, then the passing test. Show the separate worker re-run, the three rule-derived questions, the unknowns, and the not-captured list.
3. Say it has no score, rank, or verdict.
4. Say the limits out loud: the output is collapsed on screen in the video; the commits were made outside the recorded sessions; no developer answer was captured in this take; the replay API has no auth.

## Airtable form — You

Submit before 17:00 Central Thursday. Aim for Wednesday night.

## Decisions only you can make

- **Public exposure (finding F6, `plans/slice-7-review.md`).** `GET /api/replay` has no auth. Anyone who can reach the server can read the golden events and mint a 30-minute link to the private recording. It is local-only today. If you deploy it, decide whether that is acceptable. You consented to this take.
- **Home path.** The golden hook log shows `/Users/UmaYeruva`, and `git-log.txt` shows your name and email. The README discloses both. Keep the disclosure or re-record.
- **Push.** Nothing is pushed. If the form needs a repo link, you must authorize a push and choose the remote.

## Optional manual check — You

Desktop mode picker, in real Chrome with `DEVLENS_RECORD_ENABLED=1`: try both buttons on `/record` (window and desktop). After a take, check `meta.json` for `mode`, `display_surface`, `audio_tracks` (0), and `video_tracks` (1). Steps are in `apps/web/record/README.md`. This is built and unit tested but a person has not run it.

## What is verified and what is not

See the table at the top of `plans/devlens-implementation.md`. Not verified: a cold `npm install`, a real-browser desktop picker run, keyboard-only use of the Replay buttons, and a hosted deployment.
