# Record the broken-api take

You are the only person on the project and the consenting developer. This is one real Claude Code session. The Replay page still plays the hand-authored tracer files in `fixtures/`. Switching Replay to `fixtures/golden/` is a later step. Do not replace `fixtures/session.jsonl` or `fixtures/session.webm`.

## Prerequisites

1. In the repo-root `.env`, set `DEVLENS_RECORD_ENABLED=1`. Keep real keys in that file. Do not read them aloud or put them in the session.
2. From the repo root, start the app with `npm run demo` and leave it running. Next prints the URL. The record page is `/record` (usually `http://localhost:3000/record`).
3. On macOS, allow that browser under System Settings → Privacy & Security → Screen Recording. Quit and reopen the browser after changing the permission. The page uses the window picker.

## Working copy

From the repo root:

```
node examples/broken-api/scripts/take-setup.mjs
```

It prints a temp directory outside this repo. That directory is a git repo with one commit, `starter`, and project-local Claude hooks in `.claude/settings.local.json`. Those hooks append to `.devlens/events.jsonl`. Work there. Do not work in `examples/broken-api`. The copy has no verifier patches.

## Record

1. Open `/record`. Read the consent notice. Nothing is recorded until you click.
2. Click **Start recording**.
3. In the browser picker, share only the code window: the terminal or editor that will show Claude Code. Do not share the monitor. If the page says the share was the whole screen, start again and pick one window. Leave the microphone and camera off.
4. In that window, `cd` to the temp directory and run `claude`.
5. Paste this prompt. Do not add a hint about any later failure:

```
Run `npm test` exactly as written, with no pipes or extra flags, every time you run the tests. Fix only the failure it prints, then stop and leave the test result visible. Do not guess at further changes.
```

The verifier matches the failed and the passed test by the exact command string. A command such as `npm test 2>&1 | tail -20` will not match `npm test`, so a take with mixed commands is rejected.

6. When Claude stops, run `npm test` yourself. The starter names the first failure. After that edit, the test still fails. Do not tell Claude why. If Claude changed the test, README, or package.json, restore them, then commit only the client. Do not squash.

```
git checkout HEAD -- tests README.md package.json
git add src/client.js
git commit -m first-fix
```

7. Run `claude` again and paste the same prompt. Let this round finish so `npm test` passes. Commit again. Do not squash. History stays `starter`, then `first-fix`, then `final-fix`.

```
git checkout HEAD -- tests README.md package.json
git add src/client.js
git commit -m final-fix
```

8. Each test command must be `npm test`. If a question UI asks what failed, type a short honest answer about the failure on screen. This build has no question UI during the task, so skip that step.

## Stop and review

1. On `/record`, click **Stop**.
2. Play the video on the page. It should show only the code window. If you see another window, a message, or a secret, click **Delete** and record again.
3. Click **Upload** only after that review. Upload goes to private storage.

## Export

The page does not write a WebM file for you. While the player is visible, run this in the browser console:

```
const v = document.querySelector('video');
const a = document.createElement('a');
a.href = v.currentSrc || v.src;
a.download = 'session.webm';
a.click();
```

From the repo root, with `<temp>` as the working copy and `<webm>` as the downloaded file:

```
cp <temp>/.devlens/events.jsonl examples/broken-api/fixtures/golden/session.jsonl
cp <webm> examples/broken-api/fixtures/golden/session.webm
git -C <temp> log --stat > examples/broken-api/fixtures/golden/git-log.txt
npm run fixture:verify -- broken-api
```

Until those two files exist, the verifier exits with `golden fixture not recorded yet`.

## If something fails

Do not edit the JSONL by hand. Delete the take, run `take-setup.mjs` again, and re-record. Let Claude edit `src/client.js` in the editor. A shell-only rewrite can leave the log without a file edit, and this verifier will reject that take. Leave the tracer files in `fixtures/` alone. Replay keeps using them until a later slice switches it to `fixtures/golden/`.
