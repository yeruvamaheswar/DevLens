# Slice 1 tracer

Implementation only; independent verification is pending. Run all commands from the repository root with Node 22 or later.

- `npm install` installs the tracer dependencies.
- `npm run demo` serves `/replay` on localhost:3000. Missing server configuration or a failed remote read falls back to local fixtures with a visible warning.
- `npm run demo -- --offline` serves the same page without Supabase calls. `/replay?offline=1` also forces local mode.
- `npm run check` checks types.
- `npm run test:tracer` runs rule regression checks.
- `npm run demo:smoke` reports each check as PASS, FAIL, or SKIPPED(reason), and exits non-zero on any FAIL. With a server key it requires live Supabase, checks publishable insert denial, and fetches signed media. Without a key it lists each live check as SKIPPED; local PASS lines do not establish live access.
- `npm run demo:smoke -- --offline` checks the committed fixture without network calls.
- `npm run build && npm run check:bundle` builds the browser assets and rejects the server credential name or configured value in those assets. The bundle check fails if assets are absent.
- `npm test --prefix examples/broken-api` must fail with `wrong base URL`. This starter stays broken; the passing patch in the JSONL is synthetic evidence.

Apply `supabase/migrations/20261026210000_devlens_evidence.sql` to **only** project `hivfaqlabtbrhrviwrrm` with the Supabase SQL editor or an authenticated CLI. The migration is not applied by these commands. No CLI was installed. The timestamp filename was created directly because the CLI was unavailable.

Apply `supabase/migrations/20261026220000_edges_rel_check.sql` after the evidence migration to constrain edge relations. It validates existing rows and has not been applied by the repair task.

After applying the migrations and filling the existing `.env` server credential privately, run `npm run ingest:fixture`. It is idempotent for fixture rows and the private object. It rejects any other project hostname. It prints only event, edge, and object counts. Restart the demo after changing `.env`. Supabase reads use the publishable credential; signing uses a server credential with a 120-second lifetime. Reload Replay to refresh an expired link. There is no browser write route and no browser upload route.

The private `recordings` bucket has no public read or write policies. Table policies expose only the tracer session. No user accounts or live ingest endpoint are included. This is a local demo, not an authenticated hosted product.

Shared contracts live in `event.ts`. Fixture events retain raw payloads. Every synthetic payload carries `tracer fixture, hand-authored`. All derived edges are inferred and cite a fixed rule and event IDs. Missing media offsets disable seeking. There is no model dependency or separate sandbox result. A two-test input can produce a verifies edge to the earlier failure; only a stream with an explicit patch reference produces a patch claim.

The video is a generated six-second test pattern, with fixture provenance in its WebM title metadata. It has no audio. It is not a real code-window recording and has not received independent visual approval. The page states this. The tiny sample demonstrates seeking only.

Required Next.js bootstrapping files outside the named owner files: root `tsconfig.json`; `apps/web/tsconfig.json`; `apps/web/next-env.d.ts`; `apps/web/app/layout.tsx`; thin route wrappers at `apps/web/app/replay/page.tsx`, `apps/web/app/api/replay/route.ts`, and `apps/web/app/api/replay/media/route.ts`. They keep the requested implementation paths intact while supplying Next.js App Router entry points. Next.js may generate `next-env.d.ts` and update its TypeScript configuration when a verifier starts or builds it.
