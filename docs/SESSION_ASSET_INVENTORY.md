# DevLens session asset inventory

Status: discovery result, 2026-10-29. Read-only audit, except one preservation copy (see [Preservation](#preservation-action-taken)).

## Result

- **9 real test-take recordings exist.** Each one has a linked event log. 7 links are explicit (IDs in a summary or meta file). 2 links are probable only, because the video file was renamed after the take.
- **1 take is already in Supabase:** the golden Claude Code take (`broken-api`). It is the only take with an exact sync clock, a full failure-to-fix chain, and an independent sandbox re-run.
- **Neither named recorder video is in Supabase.** Both are 229–259 MB. The Supabase project is on the Free plan, which caps every file at 50 MB.
- **The Full-Stack take's event log existed only in `/tmp`.** A later take overwrote the project copy. I copied it to a durable folder. Nothing was deleted.
- **No recorder take carries media offsets.** Sync for recorder takes must be derived from the recorder clock and then checked against on-screen anchors. I did this for the Full-Stack take: two anchors agree within ±0.4 s.
- **Videos are not redacted.** The recorder takes are full-screen captures. Text redaction of event logs does not cover them. Each needs a human watch-through before upload.

## How links were established

A video and an event log count as linked only when one of these holds. A matching filename or timestamp alone never counts.

| Basis | Meaning |
|---|---|
| `meta` | A `meta.json` or `recording-meta.json` names the recording and its wall-clock window. |
| `summary` | The recorder's summary file holds both `rawFile` (exact video path) and `session_id` or `thread`. |
| `code` | The recorder script names the video and the run folder from the same `STAMP` constant. |
| `probable` | The summary names a file that was later renamed. The time window and duration agree. Needs Uma's confirmation. |

Extra checks used: SHA-256 of the video, event IDs present in the log, event times inside the video window, and frame checks.

## Recordings

Paths are relative to `~/Code-Git-Repos/`. Durations, codecs, and sizes come from `ffprobe`. Hashes are the first 16 hex characters of SHA-256 (full values for key files are in the [proof section](#association-proof-full-stack-take)).

| ID | Video | Size | Duration | Video stream | Capture | SHA-256 (16) |
|---|---|---|---|---|---|---|
| R1 golden | `DevLens/examples/broken-api/fixtures/golden/session.webm` (also in Supabase `recordings/d4ce73f0-…/take.webm`, same byte count) | 16.0 MB | 276.8 s | VP8, frames ~2462×1582 (header says 238×152) | Browser `MediaRecorder`, one window, no audio | `f718ffb052c2db35` |
| R2 Full-Stack take 2 (named) | `devlens-demo-recorder/out/devlens-fullstack-demo-1793241546273.mp4` | 228.7 MB | 304.07 s | H.264 1920×1080 30 fps, moov at end | ffmpeg avfoundation, full screen, no audio | `490967b67921acab` |
| R2-dup | `devlens-demo-recorder/out/old/fullstack-take2.mp4` | 228.7 MB | 304.07 s | same | byte-identical copy of R2 | `490967b67921acab` |
| R3 T3 named take | `devlens-demo-recorder/out/devlens-t3-demo-raw-1793307643196.mp4` | 259.2 MB | 494.77 s | H.264 1920×1242 30 fps | ffmpeg avfoundation, full screen, no audio | `ff5c748a44ab2bd4` |
| R4 T3 take 4 (aborted) | `devlens-demo-recorder/out/devlens-t3-demo-raw-1793308221665.mp4` | 141.1 MB | 271.70 s | H.264 1920×1242 | full screen | `2dc16d5ccec5768b` |
| R5 T3 take 3 (recorded DevLens demo) | `DevLens-t3-fullstack/.devlens/recordings/take-3/screen.mkv` and its transcode `…/t3/mcp:launch:a483…/recording.webm` (49.3 MB) | 15.7 MB | 305.27 s | H.264 1728×1118 15 fps | ffmpeg avfoundation, monitor ("desktop" mode), consent recorded | `b0c86ec957a1cdc8` |
| R6 agent demo (current) | `devlens-demo-recorder/out/devlens-agent-demo-raw-1793237857785.mp4` | 97.5 MB | 144.90 s | H.264 1920×1080 | full screen | `bbdd037ac50bb290` |
| R7 agent demo, take 3 | `devlens-demo-recorder/out/old/take3.mp4` | 113.9 MB | 156.33 s | H.264 1920×1080 | full screen | `dfab292059bed486` |
| R8 agent demo, earlier | `devlens-demo-recorder/out/old/devlens-agent-demo-raw-1793220406610.mp4` | 107.1 MB | 150.20 s | H.264 1920×1080 | full screen | `08412d1b835ffd7d` |
| R9 Full-Stack take 1 | `devlens-demo-recorder/out/old/fullstack-take1.mp4` | 270.3 MB | 396.00 s | H.264 1920×1080 | full screen | `2d633b0f411eefe5` |

Not test takes, listed so nobody migrates them by mistake:

| File | What it is |
|---|---|
| `DevLens/examples/broken-api/fixtures/session.webm` (6 s, also in Supabase `recordings/tracer-fixture-1/`) | Hand-authored placeholder. Its title tag says "not a live take". |
| `DevLens/.build/demo-videos/devlens-fullstack-demo.mp4` (8.4 MB) and `devlens-t3-workflow-demo.mp4` (14.1 MB) | Low-bitrate renditions of R2 and R3, made 2026-10-29 17:18 by another session. Frame-checked: 53–58 dB PSNR against the source at the same timestamps (control: 20 dB). Faststart. Only one keyframe every ~7.5 s. |
| `DevLens-t3-fullstack/examples/broken-api/fixtures/golden/*` | Worktree copy of R1. |
| Other `.mp4` files under `Panchatantra-…`, `designOS-by-Uma` | Unrelated projects. |

## Event and analysis sources per take

| ID | Agent session(s) | Link | Event source (authoritative) | Events | Edges | Re-run | DevLens Q&A | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | Claude Code `ec6f600a-…`, `44a60462-…` | `meta` (`recording_id d4ce73f0-…`) | Supabase `events`/`edges`; same as `DevLens/examples/broken-api/fixtures/golden/session.jsonl` + `rerun.jsonl` + `git-diffs.patch` | 31 (30 + re-run) | 32 | sandbox, passed | none (page says so) | **Complete**, in Supabase |
| R2 | Claude Code `a04c678d-a85d-4fa6-bcae-bb35723fac7e` | `summary` (`out/old/fullstack-take2-summary.json`) | `devlens-demo-recorder/out/rescued-tmp-backups/devlens-demo-backup-1793245064520/events.jsonl` (+ `recruiter.jsonl`, `agent-ledger.jsonl`). Second source: Claude Code transcript `~/.claude/projects/<encoded-project-path>/a04c678d-….jsonl` | 90 | 91 planned (dry run) | none | 3 asked, 3 answered | **Partial**: no re-run, derived sync |
| R3 | T3 thread `mcp:launch:2b44bbad…` | `summary` (`out/t3-run-1793307643196/summary.json`: `thread`, `rawFile`) | `DevLens-t3-fullstack/.devlens/t3/mcp:launch:2b44bbad…/` (`capture.json`, `events.jsonl`, `edges.jsonl`). DevLens log: `out/t3-run-1793307643196/devlens-take/events.jsonl` (68) | 66 | 51 (capture's own rules) | none | 12 asked, 12 answered | **Partial**: no re-run, sync not yet calibrated, experimental adapter |
| R4 | T3 thread `mcp:launch:fddd03c8…` | `code` (same `STAMP` for run folder and video) | `…/t3/mcp:launch:fddd03c8…/` and `out/t3-run-1793308221665/devlens-take/events.jsonl` | 38 | 44 KB file | none | 7 asked, 6 answered | **Failed take**: recorder stopped with `TypeError: fetch failed` in step 2 (`out/t3-take4.log`) |
| R5 | T3 thread `mcp:launch:a4832502…` | `meta` (`recording-meta.json`, `recording_id t3-take-3-screen`) | `…/t3/mcp:launch:a4832502…/` (local import, 7 edges) and saved copy `DevLens-t3-fullstack/examples/t3-captures/t3-fullstack-take-3/` (untracked, larger `edges.jsonl`) | 37 | 7 local / more in saved copy | sandbox, passed | none | **Near complete**, experimental adapter. Two capture versions: pick one before ingest |
| R6 | Claude Code `5095239d-…` | `summary` (`out/run-summary.json`) | `devlens-agent-demo/.devlens/events.jsonl` | 32 | not planned | none | 3 / 3 | Partial. Superseded demo |
| R7 | Claude Code `448f6c73-…` | `probable` (summary names `…1793237636189.mp4`; file is `old/take3.mp4`) | `rescued-tmp-backups/devlens-demo-backup-1793237844210/events.jsonl` | 32 | — | none | 3 / 3 | Uncertain link. Superseded |
| R8 | Claude Code `b3423a90-…` | `summary` (`out/old/run-summary.json`) | `rescued-tmp-backups/devlens-demo-backup-1793237626060/events.jsonl` | 31 | — | none | 3 / 3 | Superseded |
| R9 | Claude Code `b5a788d8-…` | `probable` (summary names `…1793241063570.mp4`; file is `old/fullstack-take1.mp4`) | `rescued-tmp-backups/devlens-demo-backup-1793241539337/events.jsonl` | 89 | — | none | 3 / 3 | Uncertain link. Superseded by R2 |

Edges for Claude Code takes come from the rule linker (`packages/link/src/rules.ts`). T3 captures ship their own `edges.jsonl` from the adapter and question detectors (rules `rule-1-prompted-v1`, `M1`–`M6`, `devlens-agent-cites-v1`, `answer-question-id-v1`). The generic linker rebuilds only 16 of R3's 51 edges. So ingest must keep each T3 capture's own edges.

### Sessions with events but no recording

| Session | Where | Why no video |
|---|---|---|
| Full-Stack take 3, `985704fb-…` | `devlens-fullstack-demo/.devlens/events.jsonl` (90 events) | Mac locked during the take. Summary names `…1793245074984.mp4`, which does not exist. |
| T3 threads `33a9f641-…`, `mcp:launch:b9949879…` (take 1), `mcp:launch:762990fc…` (take 2, has re-run), `mcp:launch:ea6de6f4…` (rehearsal) | `DevLens-t3-fullstack/.devlens/t3/` | Not recorded, or the rehearsal produced no video file. |
| SprintBoard rehearsal | `DevLens/examples/t3-captures/sprintboard-rehearsal/`, published as `t3-captures/rehearsal-2-sprintboard/` | Never recorded. Prompts were written by an agent. |
| Three local T3 imports | `DevLens/.devlens/t3/` | Development imports. |
| Four early agent-demo runs (`961f2c26`, `2b86b84e`, `203ceb0b`, `e058be67`) | `rescued-tmp-backups/` | Dry runs. |

## Sync status per take

`media_offset_ms` is `null` in every local event log. The golden take gets offsets at link time from `meta.json`. Recorder takes have no `meta.json`.

| ID | Basis | Accuracy | Evidence |
|---|---|---|---|
| R1 | Observed: browser `MediaRecorder` wall clock (`wall_start_ms 1793117455405`) | exact to the clock | Stored offsets in Supabase. `fixture:verify` passes. |
| R2 | Derived: video time 0 = filename stamp + 3.4 s | ±0.4 s, checked at 21 s and 51.5 s | Frame checks: first tool call on screen at 20.8–21.0 s (predicted 21.0 s); "src/tickets.js has been updated" at 51.4–51.8 s (predicted 51.5 s). No anchor near the end yet. |
| R3 | Derived: `timeline.json` mark `recording_start` (+24.83 s after the script clock) minus the 2 s post-spawn wait | unknown until calibrated | No frame check yet. |
| R5 | Derived: stop time minus file duration | about ±1 s (stated in `recording-meta.json`) | Not frame-checked in this audit. |
| R4, R6–R9 | Recorder clock, not calibrated | unknown | — |

## Sensitive content

| Item | Finding |
|---|---|
| Secrets in event logs | None found by pattern scan (Supabase `sb_secret_`, Anthropic keys, JWTs, `key=`/`token=` assignments) in R1, R2, R3, R5 logs. |
| Home paths | Many: R2 log has 260 `/Users/<name>` occurrences, R1 34, R3/R5 3–4. Raw hook payloads also hold `transcript_path` and `cwd`. |
| Emails | None in the scanned logs. `golden/git-log.txt` has the author's name and email (known, accepted in README). |
| Video content | Not sanitized. Recorder takes are full-screen: window titles show the macOS user name, the menu bar shows date, time, and status icons, and Chrome windows are visible. Frames carry the caption "SCRIPTED DEMO – CLAUDE CODE PLAYED THE DEVELOPER AND TYPED THE ANSWERS" (R2). Each video needs a human watch-through before upload. |
| Authorship | R1 prompts were typed by the developer. R2 and R3 prompts and question answers were scripted by the recorder (Claude played the developer). R5 prompts were written by the DevLens Tech Lead agent. The library must label this. |

## Association proof: Full-Stack take

Phase 2 asked for one recording proven against its analysis by IDs, not by names. R2:

1. `out/old/fullstack-take2-summary.json` field `rawFile` equals the exact path of the named MP4.
2. `out/old/fullstack-take2.mp4` and the named MP4 have the same SHA-256: `490967b67921acab5d58874cd15074203c78744f73ab66538fe7e33cbf22ae52`.
3. The summary's `session_id` (`a04c678d-…`) is the only session in the rescued log (90 events).
4. All 3 question IDs in the summary's `agent.questions` exist as events in that log.
5. The events (02:39:28–02:43:43 UTC) fall inside the video window (02:39:09.7–02:44:13.7 UTC, calibrated).
6. Two on-screen anchors match the predicted offsets within ±0.4 s.
7. A Claude Code transcript named `a04c678d-….jsonl` exists for the `devlens-fullstack-demo` project.

The same method links R3 (`summary.json` names thread `mcp:launch:2b44bbad…` and the MP4; the DevLens log's only session is `t3:mcp:launch:2b44bbad…`), but its sync is not frame-checked yet.

## Missing or uncertain links

- R7 and R9: renamed files. Uma confirms or they stay unmigrated.
- R3: sync not calibrated. Needs 2–3 frame anchors before seek is enabled.
- R2: no anchor checked after 52 s. Add one near 4:06 (last passing test) to rule out drift.
- R5: two capture versions (local import with 7 edges, untracked saved copy with more). Pick one.
- R2, R3: no independent re-run. The take-2 working tree was not kept; `devlens-fullstack-demo` now holds take 3's uncommitted edits.
- R1 Supabase `edges` table also holds 1 tracer edge. Golden itself matches today's linker (32 edges).

## Preservation action taken

The recorder moves `.devlens/*.jsonl` into `/tmp/devlens-demo-backup-<stamp>/` before each take. So each take's events survive only in the next take's `/tmp` folder. macOS clears `/tmp` on reboot.

I copied all 9 backup folders (18 files) to `devlens-demo-recorder/out/rescued-tmp-backups/`, with `SHA256SUMS` and a `README.md`. `shasum -c` reports 18 OK. `diff -rq` shows the take-2 copy is identical. The `/tmp` originals are unchanged.

Still at risk: the Claude Code transcripts in `~/.claude/projects/` (Claude Code prunes old transcripts after its `cleanupPeriodDays` setting, 30 days by default).

## Commands used

All read-only except the copy above.

```
find ~/Code-Git-Repos -type f \( -iname '*.mp4' -o -iname '*.webm' -o -iname '*.mkv' -o -iname '*.mov' \) -not -path '*/node_modules/*'
ffprobe -v error -show_entries format=duration,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate -of compact <video>
shasum -a 256 <video>
ffmpeg -ss 18 -i <R2.mp4> -vf "fps=1,scale=800:-2,tile=3x2" -frames:v 1 fs-18-23.png        # frame anchors
ffmpeg -ss 30 -t 1 -i <orig> -ss 30 -t 1 -i <rendition> -lavfi "[0:v][1:v]psnr" -f null -    # rendition check
npx tsx packages/cli/src/link.ts <events.jsonl> --dry-run                                       # planned events and edges
```
