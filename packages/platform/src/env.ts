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

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    // Per-business database logins (ADR-055): each business's queries run under its own login, whose
    // password is derived from this secret. Unset: the shared broker login (local dev).
    TENANT_LOGIN_SECRET: z.string().min(32).optional(),

    // Auth (ADR-012). The secret signs sessions; required outside development and tests.
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    // Google sign-in is switched on only when both are set (owner creates the free OAuth client later).
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    // Email: with no API key, emails (verification, password reset) are written to the server log.
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).default('BizRetriever <onboarding@resend.dev>'),
    // AI (ADR-010, ADR-027). Without a key, AI features fall back to deterministic behaviour.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL_STRONG: z.string().default('claude-opus-5-5'),
    AI_MODEL_STANDARD: z.string().default('claude-sonnet-5-5'),
    AI_MODEL_FAST: z.string().default('claude-haiku-5-5'),
    // off | record (replay if recorded, else live + record) | replay (recordings only). Tests: always replay.
    AI_REPLAY_MODE: z.enum(['off', 'record', 'replay']).default('record'),
    AI_RECORDINGS_DIR: z.string().optional(),
    AI_BUDGET_DAILY_USD: z.coerce.number().min(0).default(2),
    AI_BUDGET_MONTHLY_USD: z.coerce.number().min(0).default(15),
    // File storage (ADR-013): `local` (dev/test, under STORAGE_LOCAL_DIR, default .data/uploads),
    // `postgres` (free hosted preview), `s3` (paid production; not built until then, ADR-026).
    STORAGE_DRIVER: z.enum(['local', 'postgres', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().optional(),
    // S3-compatible storage (M17, ADR-067): AWS S3, Cloudflare R2 (region `auto`, endpoint
    // https://<account>.r2.cloudflarestorage.com) or MinIO. Needed only with STORAGE_DRIVER=s3 and
    // for `storage:move`. A key that can only read and write this bucket.
    S3_BUCKET: z.string().min(3).optional(),
    S3_REGION: z.string().min(1).default('auto'),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Path-style addresses (host/bucket/key). Default: on when S3_ENDPOINT is set.
    S3_PATH_STYLE: z.enum(['on', 'off']).optional(),
    // Sign-in/sign-up rate limiting. Only the end-to-end test server turns it off.
    AUTH_RATE_LIMIT: z.enum(['on', 'off']).default('on'),
    // Who can open the internal admin page (/admin): comma-separated emails. Empty: nobody.
    ADMIN_EMAILS: z.string().default(''),
    // The demo machine's sign-in (`pnpm demo:up`). Without a password, a new one is made and shown.
    DEMO_EMAIL: z.email().default('demo@fernwood.test'),
    DEMO_PASSWORD: z.string().min(10).optional(),
    // Linked sources (ADR-058). Encrypts stored access tokens (Shopify); needed to connect a store.
    CONNECTOR_SECRET: z.string().min(32).optional(),
    // Shopify (ADR-059): a free Dev Dashboard app's credentials. Unset: "Connect Shopify" is hidden.
    SHOPIFY_CLIENT_ID: z.string().min(1).optional(),
    SHOPIFY_CLIENT_SECRET: z.string().min(1).optional(),
    SHOPIFY_API_VERSION: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .default('2026-07'),
    // More sources (M18, ADR-068): each is shown only when its free developer app's keys are set
    // (and CONNECTOR_SECRET). WooCommerce needs no keys, only an https APP_URL.
    QUICKBOOKS_CLIENT_ID: z.string().min(1).optional(),
    QUICKBOOKS_CLIENT_SECRET: z.string().min(1).optional(),
    QUICKBOOKS_ENVIRONMENT: z.enum(['production', 'sandbox']).default('production'),
    XERO_CLIENT_ID: z.string().min(1).optional(),
    XERO_CLIENT_SECRET: z.string().min(1).optional(),
    SQUARE_APPLICATION_ID: z.string().min(1).optional(),
    SQUARE_APPLICATION_SECRET: z.string().min(1).optional(),
    SQUARE_ENVIRONMENT: z.enum(['production', 'sandbox']).default('production'),
    SQUARE_API_VERSION: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2026-09-16'),
    // Webhooks (M16, ADR-066) are never sent to private or internal addresses. Only local
    // development and the end-to-end tests turn this on (a receiver on localhost); never a real
    // deployment (`pnpm preview:check` refuses it).
    WEBHOOKS_ALLOW_PRIVATE: z.enum(['on', 'off']).default('off'),
  })
  .superRefine((env, ctx) => {
    if (
      env.STORAGE_DRIVER === 's3' &&
      !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
      });
    }
    if (env.STORAGE_DRIVER === 's3' && env.S3_REGION === 'auto' && !env.S3_ENDPOINT) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_REGION'],
        message: 'set S3_REGION (AWS) or S3_ENDPOINT (R2, MinIO)',
      });
    }
    if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'required in production (at least 32 characters)',
      });
    }
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
  // `KEY=` in a .env file means "not set", not "set to an empty string".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(raw);
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
