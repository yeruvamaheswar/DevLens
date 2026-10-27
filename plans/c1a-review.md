# C1a review (independent)

Verdict: PASS WITH FINDINGS. No blocking defect. All required behavior holds.

## Commands
```
$ npm run test:questions
 RUN  v5.0.5
 Test Files  3 passed (3)
      Tests  33 passed (33)
   Duration  170ms

$ npx tsc --noEmit
(no output, exit 0)
```
A throwaway probe test (deleted after the run) confirmed:
- `-c c.txt`, `flask==1 # x` with CRLF, `django @ https://x`, `FastAPI[all]>=1`, `psycopg[binary]`, and `SQLAlchemy_x` all parse to the right names.
- A BOM-prefixed package.json throws.
- npm aliases are matched by key only.
- `mongoose`, `knex`, and `sequelize` yield nothing.

Scope was not changed: `git status` shows only the C1a files plus the pre-existing changes. Banned wording (score, rank, hire) is absent in all five files.

## Findings
1. Low. `catalog.ts:24` and `detect.ts:42` (npm alias keys). Detection uses the dependency key, not the value.
   - `"react": "npm:preact@10"` yields a React choice. A false positive.
   - `"foo": "npm:react@19"` yields nothing. A false negative.
   - Rare. Accept, or note it in the contract.
2. Low. `detect.ts:64` (BOM). `JSON.parse` rejects a leading `﻿`, so a BOM package.json throws "Malformed". The throw is allowed by the spec, but a Windows-saved file would fail the whole change. Strip the BOM before parsing if wanted.
3. Low. `detect.ts:91` and `:92`. `-c file`, `-i url`, and `-f url` are not skipped. They parse to a junk name (`-c`) that never matches the catalog, so they are harmless today. A line like `flask\` (continuation with no space) yields `flask\`, which never matches. The "option lines" rule is only partly honored: only `-r`, `-e`, and `--` are skipped. Suggest `startsWith('-')`.
4. Low. `catalog.ts` mainstream gaps. Not required by the plan, but common:
   - MongoDB: `mongoose` (npm) and `motor` (pypi).
   - ORM: `sqlmodel`. The plan table has no Sequelize or Knex, so those are fine.
   - SQLite: `bun:sqlite` has no package.
   - Remix: `react-router` v7. Skip it unless wanted.
   - A project that adds only `mongoose` gets no database question.
5. Info. Cross-category peers are not mixed: a given package maps to one option. Same-option peers (`react` + `react-dom`, `redux` + `react-redux`, `prisma` + `@prisma/client`) are deduped to one choice. `supabase` (npm CLI) maps to Supabase and is a reasonable guess.
6. Info. Test strength. The tests cover moves between fields, the null before, normalization, and the malformed path. `detect.test.ts` has no test for any of these:
   - CRLF.
   - Inline comments.
   - `name @ url`.
   - A requirements `before: null`.
   - An empty `evidence_event_ids` passthrough.
   - A package in both fields at once.

   A wrong implementation that handles only `\n`, or that keeps `pkg==1 # comment` whole, may still pass. Suggest 2 to 3 more cases. Pypi names in the catalog are all PEP 503 normalized, and a test enforces it.

## Missing from the spec check
None. CATALOG covers every category except Backend language. The option order matches the plan table. `node-test` has no packages. Package mapping is unique per ecosystem.
