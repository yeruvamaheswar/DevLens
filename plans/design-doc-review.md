# Slice 3 independent review

Scope: `DESIGN.md` and `.impeccable/design.json`, compared directly with the eight supplied source files and the direction contract. No source files changed. Static source review; no browser behavior check was run.

## Findings, ranked by severity

### Major

1. **Sidecar invents unshipped color ramps.** `.impeccable/design.json:11-139` declares the tonal ramps listed below. None of these values appears in the shipped CSS palette (`apps/web/app/globals.css:6-25`, dark overrides at line 52). `DESIGN.md:5-33` contains the actual named colors instead. Remove the extra ramps or explicitly identify them as non-shipping proposals.

- cobalt: #0c2056, #132f80, #193fab, #577be0, #8fa7ea, #c7d3f5, #e9edfb
- red: #500c10, #781217, #a0181f, #d6565d, #e48e93, #f1c7c9, #fae8e9
- green: #04321b, #064b28, #086436, #479e72, #84bea1, #c2ded0, #e6f2ec
- amber: #463100, #6a4900, #8d6200, #c49b40, #d8bc80, #ebdebf, #f7f2e6
- ground: #616262, #929392, #c2c4c3, #f6f8f7, #f9fafa, #fcfcfc, #fefefe
- ink: #080a0b, #0c0e11, #101316, #4f5255, #8a8c8e, #c4c5c6, #e8e8e8
- muted: #202326, #2f3539, #3f464c, #7b8287, #a7acaf, #d3d5d7, #edeeef
- rule: #505352, #797c7a, #a1a6a3, #d6dbd9, #e4e7e6, #f2f3f2, #fafafa
- band: #080a0b, #0c0e11, #101316, #4f5255, #8a8c8e, #c4c5c6, #e8e8e8

2. **Color meaning rules contradict shipped evidence and recorder states.** `DESIGN.md:151-152,167,261` restricts red/green to failed/passed and prohibits using those colors on evidence. The sidecar repeats this at `.impeccable/design.json:272,303`. Yet add/delete evidence uses green/red tints (`apps/web/app/globals.css:1151-1156`; classification in `apps/web/replay/page.tsx:65-74`). Recording uses red and uploaded uses green (`apps/web/app/globals.css:1705-1708,1736-1739,1751-1752`; `apps/web/record/page.tsx:26-29`). Document the exceptions; the doc's own diff and recording descriptions already acknowledge them.

3. **The fixed-size rule excludes shipped sizes.** `DESIGN.md:187,255` and `.impeccable/design.json:282,297` say to use only 11, 12, 14, 16, 20, 26 and 30px. CSS also uses 19px wordmark (`apps/web/app/globals.css:178`), 13px navigation/buttons/line titles/tables (lines 213,286,620,1348), 11.5px chips (347), 10.5px stamps (767), 15px passed-station titles (773), and the fluid hero (1566). The sidecar itself uses 13px and 11.5px at lines 203,219. State the base scale and its real exceptions.

4. **Not every displayed number is an event-linked count or time.** `DESIGN.md:133,250` and `.impeccable/design.json:255,292` make that universal claim. Shipped usage includes dollar prices (`apps/web/replay/page.tsx:629,739`); the player note includes frame and box dimensions (lines 16-21,612); home caption counts are plain text (`apps/web/app/page.tsx:17,43`); usage counts are plain table cells (`apps/web/replay/page.tsx:732-738`). Scope the claim to relevant summary interactions and document usage context.

### Minor

5. **Typography roles overstate uniform values.** `DESIGN.md:43-52,180-184` describes page titles as 20px, answers as 30px, station titles as 26px, limits labels as 11px/700/0.08em, and mono as 12-14px (frontmatter mono 12px/400/1.55). Actual record title is 26px (`apps/web/app/globals.css:1643-1646`); mobile answers/station titles become 26px/20px (1920-1924); limits headings are 12px/800/0.1em (1268-1272); evidence headings use 0.09em tracking (1091-1098); IDs use 11px/1.4 (1215-1217), citations 11px (1434-1437), and assertions 14px/600/1.35 (1111). Sidecar typography purposes at `.impeccable/design.json:150,154,162,166` repeat the incomplete mapping. Document these concrete variants.

6. **Summary cell height is a minimum, with a mobile override.** `DESIGN.md:108` states `height: 64px`, while CSS uses `height: 100%` and `min-height: 64px` (`apps/web/app/globals.css:476-478`), changing the minimum to zero and padding to 6px 8px on mobile (1887-1889). The sidecar correctly uses `min-height` at `.impeccable/design.json:235`, so it also disagrees with the frontmatter.

7. **Sidecar samples lose shipped dark-mode colors.** `DESIGN.md:141,215` promises OS dark mode and dark primary-button text. `.impeccable/design.json:211` keeps primary text white, while CSS explicitly changes it to `#0e1215` (`apps/web/app/globals.css:316-321`). The sidecar hardcodes light diagram colors/fills (JSON line 241) and limits background/text (250), unlike the shipped variable-based diagram and limits (`apps/web/app/globals.css:645-657,706-752,1264-1265`) and dark overrides (52-71). These samples cannot represent the claimed dark scheme as written.

8. **The mobile 44px touch-target claim is too broad.** `DESIGN.md:195` says mobile touch targets reach 44px. CSS applies that minimum to navigation (`apps/web/app/globals.css:1806-1809`), but activity buttons remain 18 by 22px (973-984); summary minimum height is removed (1887-1889), and ordinary buttons retain 13px line-height plus 20px padding and borders (285-290). Limit the claim to navigation.

9. **Filtering dims marker parts, not whole stations.** `DESIGN.md:230` says unmarked stations drop to 35% opacity. CSS only dims `.mk`, failed circles and passed discs (`apps/web/app/globals.css:781-789`); labels change to muted, selection rings and stamps stay opaque, and the line itself becomes 45% opaque (776-778). Describe the actual scoped treatment.

10. **The selected-station ring is not the only overlay.** `DESIGN.md:199` says it is the only overlay. The video has an absolutely positioned recording tag with z-index 1 (`apps/web/app/globals.css:886-898`; rendered at `apps/web/replay/page.tsx:580-581`), and the activity strip has an absolute playhead (CSS 1050-1057). Qualify the depth statement.

11. **The universal diagonal rule needs a marker exception.** `DESIGN.md:206,260` and `.impeccable/design.json:302` allow only 45-degree diagonals. Route geometry follows that rule (`apps/web/replay/compile.ts:332-355`), but the passed marker's second check segment goes from (-1.5,+4.5) to (+6.5,-4.5), a delta of (8,-9), not 45 degrees (`apps/web/ui/line.tsx:32`). The sidecar repeats that geometry at line 241. Restrict the rule to route lines or document the icon exception.

## Checks and limits

Requested command: exit 0.

```text
pass: design doc checks
```

The command validates JSON syntax, the required verdict sentence, and DESIGN.md hex presence only. It does not validate sidecar ramps, typography, or behavior.

Confirmed matching: DESIGN.md's explicit hex values; font families and loaded weights (`apps/web/app/layout.tsx:3-6`); spacing scale; route weights; marker shapes and re-run radius; breakpoint values; motion duration/easing and reduced-motion condition. Buttons, chips, navigation, summary filters, both diagram orientations, activity strip, evidence, tables, limits, and recorder state all exist. Station selection calls seeking and changes evidence (`apps/web/replay/page.tsx:456-462`); keyboard activation exists (`apps/web/ui/line.tsx:59-63,103-108`). Answers render stored text (`apps/web/replay/page.tsx:127,692`).

Product limits pass: neither document presents score, rank, or hire verdict as a feature. Both retain “No verdict on the developer.” No product-limit blocker found. Findings concern documentation accuracy; correction of the two design files remains open. No user decision is needed for this review.

Verdict: FAIL
