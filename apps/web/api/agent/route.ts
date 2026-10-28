import { applyPost, projectDirFromEnv, readAgentState } from './state';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  return Response.json(readAgentState(projectDirFromEnv(process.env)), { headers: NO_STORE });
}

export async function POST(request: Request) {
  const dir = projectDirFromEnv(process.env);
  // A JSON content type forces a cross-origin page to ask first. Nothing is read from an odd request.
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'body was not JSON' }, { status: 400, headers: NO_STORE });
  }
  const result = applyPost(dir, input);
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}
