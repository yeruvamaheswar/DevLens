# Slice 3 third review

Scope: `DESIGN.md` and `.impeccable/design.json`, compared with the eight shipped source files. No source files changed. Static source review; no browser check was run. The second review left one major and three minors. The writer also claims six further fixes. Each is tested below.

## Earlier findings

1. **Fixed.** The summary band is no longer “every number is a count or a time linked to events.” `DESIGN.md:138` and the Do at `DESIGN.md:255` (sidecar copies at `.impeccable/design.json:165` and `:202`) name three kinds, and the compiler matches them on the populated path (`apps/web/replay/compile.ts:220-242`; rendered at `apps/web/replay/page.tsx:362-369`):
   - Counts and the recording-time range keep `event_ids` and `href: null`, so they are filter buttons.
   - Separate re-run is the status word `passed`, `failed`, `unknown`, or `none` (`apps/web/replay/compile.ts:229`).
   - Questions answered and coding-agent usage have `event_ids: []` and link to `#questions` and `#usage`.
   Empty values still fall outside those sentences. See Minor 1.

2. **Fixed.** The activity caption is 0.08em and the evidence heading is 0.09em (`DESIGN.md:187`; `.impeccable/design.json:72`). CSS matches (`apps/web/app/globals.css:964-967` and `:1095-1097`). Desktop column headers are 0.08em (`apps/web/app/globals.css:1359-1362`); the mobile stand-in labels are 0.06em (`apps/web/app/globals.css:1875-1880`).

3. **Fixed.** The overview limits 0, 45, and 90 degrees to route and rule lines (`DESIGN.md:136`; `.impeccable/design.json:165`). The shapes sentence and the don’t exempt marker glyphs (`DESIGN.md:211,265`; `.impeccable/design.json:212`). Route joins are horizontal, vertical, or equal-delta diagonals (`apps/web/replay/compile.ts:332-355`). The passed check is still the `(8,-9)` segment (`apps/web/ui/line.tsx:32`), and the doc now leaves that glyph free.

4. **Fixed for the tokens the second review named.** Frontmatter `-dark` hexes match the dark swap, including amber, rule-strong, the three tints, band-ink, and band-muted (`DESIGN.md:24-40`; `apps/web/app/globals.css:52-68`). `DESIGN.md:150` says `band-rule` and `band-amber` keep their light values, and they do (`apps/web/app/globals.css:69-70`). `DESIGN.md:165` no longer calls `rule-strong` ink in dark mode. One swapped variable is still unnamed. See Minor 2.

## Six extra claims

1. **Shape, colour, and word: accurate on the interactive surfaces, short on the home motif.** Replay stations carry a title (`apps/web/ui/line.tsx:139-141`), table status marks sit beside the status word (`apps/web/replay/page.tsx:653`), chips pair a shape with a word (`apps/web/app/globals.css:341-387`), and the recorder pairs a mark with a phase word (`apps/web/record/page.tsx:45-47`). Strip ticks expose a word in the accessible name (`apps/web/replay/page.tsx:316`) under a visible lane label. The home compact line draws no station titles. See Minor 3.

2. **Tabular numbers: accurate.** Body sets `font-variant-numeric: tabular-nums` (`apps/web/app/globals.css:90-91`). Summary cells and links use `font: inherit`, so they keep it (`apps/web/app/globals.css:326,479`). Buttons and chips set a `font` shorthand (`apps/web/app/globals.css:286,347`), which drops it. That is what `DESIGN.md:181` says. The sidecar body purpose (“Running text, tabular numbers.” at `.impeccable/design.json:68`) does not contradict it.

3. **14px running text: accurate for the body token and the lede, not for every prose block.** Body is `400 14px/1.45` (`apps/web/app/globals.css:90`). Home and record ledes are 16px (`apps/web/app/globals.css:1573-1575,1649-1651`), as `DESIGN.md:187` says. Prompts, questions, and notes use other sizes. See Minor 4.

4. **Square corners: the 2px exception is accurate; the circle list is short.** The only SVG corner radius is the re-run mark `rx={2}` (`apps/web/ui/line.tsx:36`). CSS `border-radius` is only `50%`, on the developer chip, the passed activity tick, and the passed status mark (`apps/web/app/globals.css:379,1046,1248`). Wordmark and recorder circles are extra. See Minor 5.

5. **“Nothing floats”: accurate as an elevation claim.** There is no shadow, gradient, blur, or `position: fixed` in the shipped CSS. `DESIGN.md:204` and the Flat Enamel rule (`DESIGN.md:207`; `.impeccable/design.json:197`) say nothing is raised. The phrase “nothing floats” is gone.

6. **Overlay list: the five named layers exist, and none has a shadow.** Station ring (`apps/web/ui/line.tsx:112`; `apps/web/app/globals.css:682-696`), playhead (`apps/web/app/globals.css:1050-1057`), video tag (`apps/web/app/globals.css:886-898`; `apps/web/replay/page.tsx:581`), skip link (`apps/web/ui/topbar.tsx:26`; `apps/web/app/globals.css:146-155`), and pinned strip (`apps/web/app/globals.css:1532-1544`). The same ring also strokes on hover, which the list does not name. See Minor 6. Absolute ticks, axis labels, and cross-mark bars are the parts of those components, not further overlays (`apps/web/app/globals.css:943-949,973-984,1027-1040,1231-1244`).

`DESIGN.md` and the sidecar agree on the overview, key points, rules, dos, and don’ts, including the summary-band wording and the 0.08em / 0.09em split. The sidecar sample sets `--station-fill` in dark mode (`.impeccable/design.json:152`); `DESIGN.md` never names that variable. See Minor 2.

## Findings

### Minor

1. **Empty summary values are not the three kinds the overview states.** `DESIGN.md:138` and the Do at `DESIGN.md:255` say the usage cell is a count, the re-run cell is linked to the re-run event, and the recording-time cell is a clock range linked to the first failure and the first pass. In `apps/web/replay/compile.ts`:
   - Usage is the words `not read` when usage is absent (`:242`), still with `href: '#usage'`.
   - Re-run `none` has `event_ids: []` (`:229`), so the button is disabled (`apps/web/replay/page.tsx:369`).
   - Recording time is `none` unless both endpoints exist (`:233`). One endpoint still fills `event_ids` (`:235`), so the cell can show `none` and still filter.
   `DESIGN.md:232` does say a cell with no events is disabled. A builder who copies only `:138` or `:255` still misses `not read` and the one-sided recording-time cell.

2. **Dark station fill is a real swap with no `-dark` name.** `--station-fill` goes from `#ffffff` to `#0e1215` (`apps/web/app/globals.css:25,71`). Dark station fill matches ground (`:52`), not surface (`:53`). `DESIGN.md:150` lists the `-dark` tokens and the two values that stay put, and does not mention station fill. The sidecar diagram does set it (`.impeccable/design.json:152`).

3. **The home motif does not give every mark a word.** `DESIGN.md:141` says state is always a colour plus a word. The compact line skips titles (`apps/web/ui/line.tsx:137`). The home caption names failed tests, the pass, and the re-run only (`apps/web/app/page.tsx:43`). Prompt and edit marks on that figure have no word.

4. **Prompts, questions, and notes are not 14px running text.** `DESIGN.md:187` assigns 14px to running text and 16px to the lede. Prompts and questions are 16px (`apps/web/app/globals.css:1122-1124,1181-1183`). Notes are 12px (`apps/web/app/globals.css:274-277`).

5. **Two more circles sit outside the “only curves” list.** `DESIGN.md:211` allows circles for stations, the terminus, the developer chip, and the passed marker. The wordmark is two circles (`apps/web/ui/topbar.tsx:10-11`). The recorder uses circles for idle, recording, and uploaded (`apps/web/record/page.tsx:26-30`).

6. **The station ring also shows on hover.** `DESIGN.md:204` and `:236` name selected and focused only. Hover strokes the same ring in slate (`apps/web/app/globals.css:698-700`).

7. **Activity ticks do not reuse the full station shapes.** `DESIGN.md:238` says they do. The failed tick is a cross with no ring (`apps/web/app/globals.css:1022-1040`); the station mark is a ring plus a cross (`apps/web/ui/line.tsx:20-25`). The passed tick is a disc with no terminus ring (`apps/web/app/globals.css:1043-1047`). The tool-call tick is a 3 by 12px bar (`apps/web/app/globals.css:1008-1011`), which is not a station shape.

## Checks and limits

Requested command: exit 0.

```text
pass: design doc checks
```

The command checks JSON syntax, the verdict sentence, and that every `#rrggbb` in `DESIGN.md` occurs in `apps/web/app/globals.css`. It does not check sidecar behavior, empty summary values, or geometry.

Product limits pass. Neither file presents a score, rank, or hire verdict as a feature. Both keep “No verdict on the developer.” (`DESIGN.md:3,138,263`; `.impeccable/design.json:165,210`). The don’t forbids those words (`DESIGN.md:263`). The visible “No score” statement is a limit on the home page (`apps/web/app/page.tsx:50-51`), which the Do tells the builder to keep (`DESIGN.md:258`).

No blocker. No major. Minors 1–7 are empty-state words, one unnamed fill, and small geometry and type gaps. None of them tells a builder to retarget a populated summary cell, to recolour a named token, or to “correct” the passed check. The second review’s major is closed.

Verdict: PASS
