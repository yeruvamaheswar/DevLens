# Your Rust take: step by step

Print this or keep it on a second screen. You do not need the Claude thread open while you record.
Time: about 45 minutes to build and record, 5 minutes to finish.

## Before you press record (3 minutes)

Check these. If one fails, use the fix.

| Check | How | Fix |
|---|---|---|
| DevLens runs | Open http://localhost:3000/record. It loads. | In a terminal: `cd ~/Code-Git-Repos/DevLens && DEVLENS_RECORD_ENABLED=1 npm run demo` |
| Live capture runs | In a second terminal: `cd ~/Code-Git-Repos/DevLens && npm run t3 -- watch --workspace ~/Code-Git-Repos/rust-supabase-take`. It prints `no T3 thread found yet`. | Leave it open. |
| Rust works | `cargo --version` prints 1.99 or higher. | Open a new terminal. Rust was installed today. |
| App folder is clean | `~/Code-Git-Repos/rust-supabase-take` holds only `.git`, `.gitignore`, `.env`. | Do not add code yourself. |
| Project is in T3 | T3 Code sidebar lists **rust-supabase-take**. | Add the folder in T3: Add project. |
| Keys are in place | `~/Code-Git-Repos/rust-supabase-take/.env` has `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. | Add them yourself. |

## Hide these before you record

Text redaction does not remove secrets from video frames. Do not show any of these on screen.

- The `.env` file, in any editor or in T3's file view.
- Any terminal that prints a key.
- The Supabase dashboard API keys page.
- Other T3 threads with private content. Pick the **rust-supabase-take** project and stay in it.

Audio and camera stay off. DevLens records one window only.

## Record and build

1. **Open the recorder.** Go to http://localhost:3000/record. Keep this browser tab open the whole time. Closing it stops the take.
2. **Opt in.** Click **Record one window**. Nothing is filmed before this click. Do not click "Record my desktop".
3. **Pick the window.** Your browser opens a share dialog. Choose the **T3 Code** window, one window only. Audio and camera stay off. If macOS asks, allow screen recording for the browser.
4. **Recording starts.** The page shows a running clock. Switch to T3 Code.
5. **Start a thread.** In T3, select the **rust-supabase-take** project. Start a new thread. Pick your provider and model.
6. **Send prompt 1.** Paste it. Do not edit it while recording unless you want to:

   ```
   Build a small full-stack expense tracker in this empty folder. Use Rust with axum for a JSON API, a plain HTML/JS page in public/, and a repository trait with an in-memory version and a Supabase (PostgREST) version. Write the table SQL to supabase/001_expenses.sql and do not apply it. Write cargo test tests that run offline with the in-memory repository. Run cargo test.
   ```

7. **Wait for the run to end.** Read what the agent did. Say what you think out loud only if you like. Audio is off.
8. **If a test fails**, send prompt 2:

   ```
   Tests are failing. Find the cause, make the smallest fix, and run cargo test again.
   ```

   If everything passes, do not send it. Do not cause a failure. Whatever happens is the evidence.
9. **Send prompt 3:**

   ```
   Add filtering by category and a monthly total endpoint, with tests. Run cargo test again, then write the run commands in the README.
   ```

10. **Stop when `cargo test` passes** after prompt 3. If it does not pass after two tries, stop anyway. A failed end is still a true take.

You can change the app idea or the wording. Keep three things: a Rust API, tests that run offline, and a final `cargo test`.

## Finish (5 minutes)

1. **Stop the recording** on the `/record` page.
2. **Review it.** Play the take. If a key appears on screen, click **Delete** and record again.
3. **Upload.** Click **Upload**.
4. **Watch the line.** Open http://localhost:3000/recruiter. Find your thread under sources. The "Live" chip may show.
5. **Tell Claude:** "take done". Claude then does these steps:
   - import the thread and compare the two readers;
   - fetch the recording and attach it;
   - re-run `cargo test` in the sandbox;
   - check that the recording jumps to the right moment;
   - run the independent review;
   - relabel T3 as verified only if every check passes.

## If something goes wrong

| Problem | What to do |
|---|---|
| The T3 window is not in the picker | Open T3 so its window is visible, then click **Record one window** again. |
| Recording will not start | Reload `/record` and click **Record one window** again. In macOS System Settings, allow screen recording for your browser. |
| Upload fails | The server needs `DEVLENS_RECORD_ENABLED=1`. Restart with the command above. The take stays on your device. |
| The agent asks for permission | Allow file and command access in the rust-supabase-take folder only. |
| `cargo` not found in the agent's terminal | Quit T3 and open it again, then restart the thread. |
| You see a secret on screen | Stop. Delete the take. Rotate the key if it was exposed. Record again. |
| You run out of time | Stop and tell Claude. The Claude Code golden replay is still the safe fallback. |

## Deadlines

| Time (CDT) | Step |
|---|---|
| 1:30 PM | Latest start for your take |
| 3:30 PM | Freeze for CR-12. Unverified work stays off `main` |
| 5:00 PM | Loom and the Airtable form are due |
