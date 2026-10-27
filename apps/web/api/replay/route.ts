import { readFile } from 'node:fs/promises';
import { loadGoldenExtras } from '../../../../packages/core/fixture';
import { goldenFile, loadReplay } from '../../../../packages/core/server';
import { buildReplayView } from '../../replay/view';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const replay = await loadReplay(new URL(request.url).searchParams.get('offline') === '1');
  const patch = await readFile(goldenFile('git-diffs.patch'), 'utf8');
  return Response.json(buildReplayView(replay, patch, await loadGoldenExtras()), { headers: { 'Cache-Control': 'no-store' } });
}
