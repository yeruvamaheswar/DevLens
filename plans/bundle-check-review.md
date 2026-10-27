# Review: stale-build guard in `packages/core/bundle-check.ts`

Reviewer: independent review sub-agent. No files edited except this report. No build, commit, or install run.

## Verdict

**PASS WITH FINDINGS.** The three required behaviors work: stale build fails, a fresh build passes, and a missing `BUILD_ID` fails with the required message. The findings below are minor. None causes a false PASS for the cases in the brief.

## Commands and output

### 1. `npx tsc --noEmit`

```
exit=0
```

### 2. `npm run check:bundle` (repo state)

```
> check:bundle
> tsx packages/core/bundle-check.ts

/Users/UmaYeruva/Code-Git-Repos/DevLens/packages/core/bundle-check.ts:16
if (newest.mtime > buildTime) throw new Error(`Stale build: ${newest.path} changed after the last build. Run npm run build first.`);
                                    ^


Error: Stale build: apps/web/ui/topbar.tsx changed after the last build. Run npm run build first.
    at <anonymous> (/Users/UmaYeruva/Code-Git-Repos/DevLens/packages/core/bundle-check.ts:16:37)

Node.js v24.3.0
exit=1
```

This matches the expected result. The newest source is the untracked `apps/web/ui/topbar.tsx`.

### 3. Temp-copy checks (`/tmp/bcr`)

**3a. Stale-negative, all sources set to 2020 (expect PASS)**

```
PASS: no server credential name or configured value in client assets
exit=0
```

**3b. After `touch packages/questions/src/ask.ts` (expect Stale build naming it)**

```
Error: Stale build: packages/questions/src/ask.ts changed after the last build. Run npm run build first.
    at <anonymous> (/private/tmp/bcr/packages/core/bundle-check.ts:16:37)
exit=1
```

**3c. After `rm apps/web/.next/BUILD_ID` (expect "Build client assets")**

```
Error: Build client assets before checking.
    at <anonymous> (/private/tmp/bcr/packages/core/bundle-check.ts:5:84)
exit=1
```

All three match the expected output.

## Findings

1. **Low: correctness, misleading error.** `packages/core/bundle-check.ts:5`
   - The `try/catch` around `stat(BUILD_ID)` catches every error, not only ENOENT.
   - Failure scenario: `apps/web/.next` is unreadable (EACCES). The user sees "Build client assets before checking." and runs `npm run build`, which does not fix the permission problem.
   - Fix idea: rethrow when `err.code !== 'ENOENT'`.

2. **Low: false-PASS scope gap (by design, confirm).** `packages/core/bundle-check.ts:13`
   - Only `*.ts`, `*.tsx`, and root `package.json` are checked. Files that change the build output are not checked: `.css`, `.js`, `.mjs`, `next.config.*`, `tsconfig.json`, and `.env*`.
   - Failure scenario: a user edits `apps/web/next.config.mjs` or `tsconfig.json` after the build. The check prints PASS, even though the build may now differ.
   - The brief names the file types, so this is not a deviation. Decide whether to widen the list.

3. **Low: narrow race, unverified.** `packages/core/bundle-check.ts:5` and `:16`
   - `BUILD_ID` is compared with source mtimes. If Next writes `BUILD_ID` at the start of a build, an edit made during the build looks older than the build and gets a false PASS.
   - I did not check when Next writes `BUILD_ID`. This needs a check against the Next version in use.

4. **Info: symlinks are skipped.** `packages/core/bundle-check.ts:6-9`
   - `withFileTypes` reports a symlink as neither file nor directory, so `srcFiles` does not follow it. A linked package edited after the build is not checked. The repo has no symlinked sources that I found, so impact is low.

5. **Info: mtime noise fails safe.** `packages/core/bundle-check.ts:13-16`
   - `git checkout`, `git stash pop`, and `cp` without `-p` update mtimes. That causes false STALE, not false PASS. This is the safe direction. No change needed.

6. **Info: checked and fine.**
   - `stats.reduce` has no initial value. It is safe because `package.json` is always in `sources`.
   - The `>` comparison is strict. Equal mtimes pass, which is correct.
   - The stale message uses a relative path, as the brief requires.
   - The credential scan and PASS line are unchanged, as the brief requires.

## Open decisions for the user

- Widen the checked file types (finding 2), or keep the brief's list.
- Rethrow non-ENOENT errors from `stat` (finding 1). Recommended, one line.
