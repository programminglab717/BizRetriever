import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit loads this file on its own, so load the repo-root .env files here directly.
loadEnvConfig('../..', true, { info: () => {}, error: console.error });

export default defineConfig({
  dialect: 'postgresql',
  // Only the control plane is managed by Drizzle. Tenant schemas (t_*) are managed by the
  // change-plan compiler (ADR-006) and must never appear here.
  schema: './src/schema/index.ts',
  schemaFilter: ['app'],
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATE ?? 'postgres://localhost:5432/bizretriever',
  },
  strict: true,
  verbose: true,
});
