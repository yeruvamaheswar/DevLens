// Hosted builds (Vercel) have no repo checkout at run time, so the replay and journey routes
// must carry the golden fixture files with them. Local `next dev` reads the same files from disk.
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const golden = ['../../examples/broken-api/fixtures/golden/**/*'];

/** @type {import('next').NextConfig} */
const config = {
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {
    '/api/replay': golden,
    '/api/replay/media': golden,
    '/api/journey': golden,
  },
};

export default config;
