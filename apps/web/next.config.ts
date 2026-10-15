import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// One set of .env files at the repo root serves the web app, worker, scripts and tests.
// forceReload: Next has already loaded (and cached) env files from apps/web, which has none.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', undefined, true);

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@bizr/ai',
    '@bizr/core',
    '@bizr/db',
    '@bizr/ingest',
    '@bizr/packs',
    '@bizr/platform',
  ],
  // Server-only libraries that must not be bundled.
  serverExternalPackages: ['pg', 'pg-boss', 'pino'],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;
