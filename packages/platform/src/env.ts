// @next/env is CommonJS: a default import works under both native ESM (tsx) and bundlers.
import nextEnv from '@next/env';
import { z } from 'zod';

import { findRepoRoot } from './repo-root';

/**
 * All environment variables the app reads. Keep `.env.example` in sync with this schema.
 * Values are only ever read through `getEnv()`; never read `process.env` directly elsewhere.
 */
const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_URL: z.url().default('http://localhost:3000'),

  // Database roles (ARCHITECTURE §6). The control-plane role can never read tenant data.
  DATABASE_URL_APP: postgresUrl,
  DATABASE_URL_ADMIN: postgresUrl,
  DATABASE_URL_TENANT: postgresUrl,
  // Only needed by `pnpm db:migrate` (owner of the `app` schema) and `pnpm db:setup` (superuser).
  DATABASE_URL_MIGRATE: postgresUrl.optional(),
  DATABASE_URL_SUPERUSER: postgresUrl.optional(),

  // Background jobs (ADR-011): `worker` = long-running process, `inline` = serverless drain route.
  JOB_RUNNER: z.enum(['worker', 'inline']).default('worker'),
  JOB_STEP_BUDGET_MS: z.coerce.number().int().min(1_000).default(45_000),
  JOB_DRAIN_SECRET: z.string().min(32).optional(),
});

export type Env = z.infer<typeof envSchema>;

let loaded = false;
let cached: Env | undefined;

/** Loads `.env*` files from the repo root (same precedence rules as Next.js). Idempotent. */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  // Inside Next.js the env files were already loaded by next.config.ts.
  if (process.env.NEXT_RUNTIME) return;
  nextEnv.loadEnvConfig(findRepoRoot(), process.env.NODE_ENV !== 'production', {
    info: () => {},
    error: console.error,
  });
}

export function getEnv(): Env {
  if (cached) return cached;
  loadRootEnv();
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  cached = result.data;
  return cached;
}

/** Test helper: forget the cached env so the next `getEnv()` re-reads `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}
