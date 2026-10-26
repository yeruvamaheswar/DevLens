import { loadReplay } from '../../../../packages/core/server';
export const runtime = 'nodejs';
export async function GET(request: Request) { return Response.json(await loadReplay(new URL(request.url).searchParams.get('offline') === '1'),{headers:{'Cache-Control':'no-store'}}); }
