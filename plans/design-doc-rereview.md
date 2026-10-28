# Slice 3 re-review

Scope: `DESIGN.md` and `.impeccable/design.json`, compared with the eight shipped source files. No source files changed. Static source review; no browser check was run. The writer’s claim that all 11 earlier findings are fixed is tested below.

## Earlier findings

1. **Fixed.** The sidecar no longer lists the unshipped cobalt, red, green, amber, ground, ink, muted, rule, or band ramps. `.impeccable/design.json` `colorMeta` keeps one canonical hex per named color, and each of those hexes is in `apps/web/app/globals.css:6-24`.

2. **Fixed.** `DESIGN.md:149-150,163-165` and `.impeccable/design.json:177-182` now allow `green-tint` and `red-tint` on added and deleted diff lines (`apps/web/app/globals.css:1151-1156`), red on the recording badge and live dot (`apps/web/app/globals.css:1705-1708,1736-1739`; `apps/web/record/page.tsx:26`), green on the uploaded mark (`apps/web/app/globals.css:1751-1752`; `apps/web/record/page.tsx:29`), and cobalt on the live run line (`apps/web/app/globals.css:1721-1723`).

3. **Fixed.** `DESIGN.md:185` and `.impeccable/design.json:192` state the 11/12/14/16/20/26/30px base and name the shipped exceptions: 13px, 19px, 15px, 11.5px, 10.5px, 12px limits headings, and the fluid hero. Those sizes are the ones in `apps/web/app/globals.css` (19px at 178, 13px at 213, 620, and 1348, 11.5px at 347, 10.5px at 767, 15px at 773, 12px at 1269, hero at 1566).

4. **Not fixed.** The out-of-band examples are now described correctly (usage prices, player frame and box). The summary-band rule itself is still broader than the code. See Major 1.

5. **Fixed, except one tracking value.** Page title, answer, station title, mobile sizes, limits headings, and mono variants match the CSS. The activity caption does not. See Minor 1.

6. **Fixed.** `DESIGN.md:225` says a 64px minimum that stretches to the row, removed at 720px with padding `6px 8px`. CSS uses `height: 100%` and `min-height: 64px` (`apps/web/app/globals.css:476-478`) and, at 720px, `min-height: 0` and `padding: 6px 8px` (`apps/web/app/globals.css:1887-1889`). The frontmatter no longer says `height: 64px`.

7. **Fixed.** The primary-button sample sets dark text to `#0e1215` (`.impeccable/design.json:121`), matching `apps/web/app/globals.css:316-318`. The diagram and limits samples use variables and a dark `prefers-color-scheme` block (`.impeccable/design.json:152,160`).

8. **Fixed.** `DESIGN.md:193` limits the 44px minimum to nav links and says other controls stay small. CSS applies `min-height: 44px` to nav links only (`apps/web/app/globals.css:1806-1809`). Activity ticks stay 18 by 22px (`apps/web/app/globals.css:973-984`).

9. **Fixed.** `DESIGN.md:228` matches the filter: the line at 45% (`apps/web/app/globals.css:776-778`), marker shapes at 35% (`apps/web/app/globals.css:781-785`), titles and times in slate (`apps/web/app/globals.css:787-789`), rings and stamps left opaque.

10. **Fixed.** `DESIGN.md:197` names the station ring, the activity playhead (`apps/web/app/globals.css:1050-1057`), and the video recording tag (`apps/web/app/globals.css:886-898`; `apps/web/replay/page.tsx:580-581`).

11. **Fixed at the rule.** `DESIGN.md:204` and the don’t at `DESIGN.md:258` (sidecar don’t at `.impeccable/design.json:212`) limit 0/45/90 degrees to route and rule lines and exempt marker glyphs. The passed check is still not 45 degrees (`apps/web/ui/line.tsx:32`). The overview sentence is still unqualified. See Minor 2.

## Findings

### Major

1. **The summary-band rule still tells a builder to change three shipped cells.** `DESIGN.md:131` says every summary-band number is a count or a time and links to the events it counts. The same sentence then says usage context does not link to events. The Do at `DESIGN.md:248`, and the sidecar copies at `.impeccable/design.json:165` and `:202`, repeat the “every summary-band number links to the events” rule and drop the usage exception.

   Shipped cells in `apps/web/replay/compile.ts`:

   - Separate re-run is the status word `passed`, `failed`, `unknown`, or `none`, not a count or a time (`apps/web/replay/compile.ts:72-74,229`).
   - Questions answered is the count of answers, with `event_ids: []` and `href: '#questions'` (`apps/web/replay/compile.ts:241`).
   - Coding-agent usage is a request count, with `event_ids: []`, `href: '#usage'`, and note `context only` (`apps/web/replay/compile.ts:242`).

   Those two href cells render as links, not as event filters (`apps/web/replay/page.tsx:362-368`). A builder who follows the Do would turn the re-run value into a count or a time and would point the answered and usage cells at events. Usage prices (`apps/web/replay/page.tsx:629,739`), the player frame and box note (`apps/web/replay/page.tsx:15-21`), and the home caption (`apps/web/app/page.tsx:17`) are no longer covered by the claim. The summary-band sentence still is.

### Minor

1. **Activity-caption tracking is 0.08em, not 0.09em.** `DESIGN.md:181` and `.impeccable/design.json:72` group the activity-strip caption with the evidence heading at 0.09em. The evidence heading is 0.09em (`apps/web/app/globals.css:1095-1097`). The activity caption is 0.08em (`apps/web/app/globals.css:964-967`).

2. **The overview still forbids every non-45-degree line.** `DESIGN.md:129` and `.impeccable/design.json:165` say lines run at 0, 45, and 90 degrees only. The passed check mark runs from `(-1.5,+4.5)` to `(+6.5,-4.5)`, a delta of `(8,-9)` (`apps/web/ui/line.tsx:32`). The shapes rule and the don’t already exempt that glyph (`DESIGN.md:204,258`). A builder who copies the overview alone would “correct” the check.

3. **The dark palette in the frontmatter is smaller than the CSS swap.** `DESIGN.md:143` says the `-dark` tokens replace the light values. The listed `-dark` hexes match `apps/web/app/globals.css:52-66`. These tokens also change and have no `-dark` name: `--amber` to `#e6a100` (line 61), `--rule-strong` to `#c9cfcc` (line 57), `--red-tint` to `#3a1b1e` (line 63), `--green-tint` to `#12301f` (line 64), `--cobalt-tint` to `#1a2547` (line 65), `--band-ink` to `#e8ecea` (line 67), and `--band-muted` to `#b3bcc1` (line 68). `DESIGN.md:158` also calls `rule-strong` ink. That is true in light mode (`apps/web/app/globals.css:11`) and false in dark mode, where ink is `#e8ecea` (line 54) and `rule-strong` is `#c9cfcc` (line 57). A builder who copies only the frontmatter will keep the light amber line, tints, band text, and heavy rule in dark mode.

## Checks and limits

Requested command: exit 0.

```text
pass: design doc checks
```

The command checks JSON syntax, the verdict sentence, and that every `#rrggbb` in `DESIGN.md` occurs in `apps/web/app/globals.css`. It does not check sidecar behavior or the summary-band rule.

Product limits pass. Neither file presents a score, rank, or hire verdict as a feature. Both keep “No verdict on the developer.” (`DESIGN.md:3,131,256`; `.impeccable/design.json:165,210`).

No blocker. Major 1 is a behavior a builder would copy wrongly. Minors 1–3 are small token and wording gaps.

Verdict: FAIL
