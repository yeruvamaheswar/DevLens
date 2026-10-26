import { postMeta } from '../handler';
import { loadRepoEnv, storageFromEnv } from '../storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  loadRepoEnv();
  return postMeta(request, { enabledFlag: process.env.DEVLENS_RECORD_ENABLED, openStorage: storageFromEnv });
}
