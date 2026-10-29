import { listSources, loadJourney } from '../../journey/sources';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET /api/journey lists sources. GET /api/journey?source=<key> returns one journey with its events and rule edges.
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('source');
  if (!key) {
    try {
      return Response.json({ sources: listSources() }, { headers: NO_STORE });
    } catch {
      return Response.json({ sources: [] , error: 'sources unavailable' }, { status: 500, headers: NO_STORE });
    }
  }
  try {
    const body = await loadJourney(key);
    if (!body) return Response.json({ error: 'unknown source' }, { status: 404, headers: NO_STORE });
    return Response.json(body, { headers: NO_STORE });
  } catch {
    return Response.json({ error: 'journey unavailable' }, { status: 500, headers: NO_STORE });
  }
}
