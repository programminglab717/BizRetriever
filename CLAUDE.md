# CLAUDE.md — Standing instructions for BizRetriever

## Start of every session

1. Read `docs/PROGRESS.md` (the "Current Status" section first), then `docs/PLAN.md`.
2. Check `docs/OPEN_QUESTIONS.md` for anything newly decided.
3. Work only on the current milestone. Do not start the next milestone until the current one meets its
   acceptance criteria **and** the owner has confirmed.

## End of every session (no exceptions)

1. Add a dated entry to `docs/PROGRESS.md` (completed, in progress, blockers, exact next steps) and update
   its "Current Status" section.
2. Tick completed checkboxes in `docs/PLAN.md`.
3. Record any significant decision in `docs/DECISIONS.md` (ADR format) and any new question/risk in
   `docs/OPEN_QUESTIONS.md`.

## What this is

BizRetriever is an AI business analyst for non-technical owners of small and mid-sized retail and ecommerce
businesses. Users upload messy Excel/CSV files. The AI turns them into a clean, structured database. Users
then ask questions in plain language, get an auto-generated dashboard, and receive proactive insights.
**Sell the outcome, not the database.** The database is invisible in primary flows.

First vertical: **Retail & Ecommerce** (inventory-based sellers: online stores, marketplace sellers,
physical shops, multi-channel, light wholesale). Industry knowledge lives in swappable Vertical Packs
(`packages/packs`, spec in `docs/VERTICAL_PACKS.md`). The core engine stays industry-agnostic.

## Tech stack

- TypeScript 6.0 (not 7: typescript-eslint doesn't support it yet, ADR-028), Node 24 LTS (22.12+
  works), pnpm 10 workspaces monorepo. Workspace packages export TS source (no build step).
- `apps/web`: Next.js (App Router), Tailwind CSS, shadcn/ui, Recharts (via shadcn charts).
- `apps/worker`: pg-boss worker for ingestion, loading, insights. Jobs are checkpointed steps that can also
  run serverless via a drain route (`JOB_RUNNER=worker|inline`).
- PostgreSQL 17: `app` schema (control plane, Drizzle ORM), one `t_<id>` schema per workspace (tenant data,
  managed by our change-plan compiler), and `pgboss` schema (job queue).
- Auth: Better Auth (email/password + Google), workspaces and memberships from day one.
- AI: Anthropic Claude via `@anthropic-ai/sdk`, behind our own provider interface in `packages/ai`.
  Model IDs are set by env (`AI_MODEL_STRONG`, `AI_MODEL_STANDARD`, `AI_MODEL_FAST`).
- Parsing: SheetJS (xlsx/xls), Papa Parse (csv), jschardet + iconv-lite (encodings).
- SQL validation: `libpg-query` (real Postgres parser). Validation schemas: Zod.
- Tests: Vitest (unit/integration), Playwright (e2e), `evals/` (AI accuracy suite, not run in CI by default).

## Repository layout (target, created in M0)

```
apps/web          Next.js app (UI, route handlers, server actions)
apps/worker       background job worker
packages/platform env config (Zod), logging (pino + correlation ids); no other @bizr deps
packages/db       control-plane Drizzle schema + migrations, db roles/pools
packages/core     tenancy, executor (safe tenant queries), workspaces, jobs, sql/ident, change plans,
                  ingestion, semantic layer (metrics + query compiler); later: SQL validator, merge
packages/ingest   parsing, region detection, profiling, cleaning rules, loaders
packages/ai       provider abstraction, versioned prompts, AI tasks, cost tracking
packages/packs    pack format schema + loader; packs/retail/
evals/            messy fixture files, expected models, question/answer sets, eval runner
scripts/          demo data generator, seed scripts
docs/             all planning documentation
```

## Commands

| Task | Command |
|---|---|
| Start local Postgres | `docker compose up -d` |
| Install | `pnpm install` |
| Dev (web) | `pnpm dev` |
| Dev (worker) | `pnpm dev:worker` |
| Lint / format | `pnpm lint` / `pnpm format` |
| Typecheck | `pnpm typecheck` |
| Unit + integration tests | `pnpm test` |
| E2E tests | `pnpm test:e2e` |
| Create DB roles (idempotent) | `pnpm db:setup` (test DB: `pnpm db:setup:test`) |
| Control-plane migrations | `pnpm db:migrate` (test DB: `pnpm db:migrate:test`; generate: `pnpm db:generate --name <x>`) |
| Validate vertical packs | `pnpm packs:validate` (after editing pack YAML: `pnpm packs:build`) |
| Queue a test job | `pnpm --filter @bizr/worker enqueue:noop` |
| Seed dev data (M1) | `pnpm db:seed` |
| Generate demo dataset (M2) | `pnpm demo:generate` |
| Eval suite, rules only (free) | `pnpm eval` (one suite: `pnpm eval -- --suite ingest\|questions\|dashboard\|records\|changes`) |
| Drop expired snapshots | `pnpm --filter @bizr/worker run snapshot:gc` (daily via M7's cron) |
| Demo re-upload file (M6) | `pnpm demo:generate -- --next-month <dir>` |
| AI eval suite (costs money; asks before > $1) | `pnpm eval -- --ai --limit N` |
| Local demo machine (M8) | `pnpm demo:up` |

## Coding conventions

- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`). No `any` without a comment that explains it.
- Zod schemas are the single source of truth for every AI output, change plan, query spec, and pack file.
  Infer types from them.
- Safety-critical code (`packages/core`: compiler, validator, executor, merge) is written test-first, and it
  is pure and deterministic where possible.
- Environment variables are read only through `getEnv()` from `@bizr/platform` (Zod-validated). All
  `.env*` files live at the repo root. Tests use `.env.test.local` and the `bizretriever_test` DB.
- Integration tests are named `*.int.test.ts` and must use `databaseAvailable()` from
  `@bizr/platform/testing`. CI sets `REQUIRE_DB_TESTS=1` so they can't silently skip.
- Uploaded files are read only through `getStorage()` (`@bizr/db`); bulk tenant writes only through
  `withTenantWriter` (`@bizr/core/executor`).
- Every number shown to users comes from `runQuery` / `compileQuery` (`@bizr/core/semantic`) or, in M4's
  fallback, validated SQL through the executor. Metric definitions live only in pack `metrics.yaml`.
- Background work is a `defineJob` with idempotent, checkpointed steps (`@bizr/core/jobs`). Never
  write a job that assumes it runs in one go: it must work in both worker and drain modes.
- Run pnpm scripts in filtered packages with `pnpm --filter <pkg> run <script>` (`setup` is a
  built-in pnpm command, so the `run` matters).
- Never build SQL by string concatenation with user/AI values. Use parameters, and quote identifiers through
  the single helper in `packages/core/src/sql/ident.ts`.
- Tenant data is only ever read or written through `executeTenantQuery` (`@bizr/core/executor`). DDL on
  tenant schemas only through tenancy/change-plan code running as `bizr_admin`.
- Every workspace page and server action starts with `requireWorkspace(slug)` (`apps/web/src/lib/session.ts`),
  which checks session + membership. Never trust a slug or id from the client on its own.
- Money is `numeric(18,4)` in Postgres and handled as decimal strings/`Decimal` in TS. Never JS floats for
  money.
- Every prompt lives in `packages/ai/prompts/<task>/v<N>.ts` with a version id. Never edit a released
  prompt in place; add a new version.
- UI copy follows the copy guidelines in `docs/PRODUCT_SPEC.md`. **No jargon in primary flows** ("schema",
  "table", "query", "SQL", "foreign key", "null", "join"). Use "your data", "records", "products",
  "customers".
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`). Small, focused commits.
  Feature branches. `main` must always be runnable.

## Zero-cost rule (owner decision, ADR-026)

Use free options only until the product is in production and generating revenue: local dev, free tiers,
open-source libraries. Never add a paid service, plan or add-on without asking the owner first. The only
exception is the AI API, which is hard-capped by `AI_BUDGET_DAILY_USD` / `AI_BUDGET_MONTHLY_USD` (ADR-027).
**Tests and CI must never call the live AI API.** They use replay recordings. Run evals only on demand,
with `--limit`.

## Safety rules (non-negotiable)

1. **The LLM never executes free-form SQL.** Structural changes go through a typed JSON change plan
   compiled to SQL by deterministic code. Questions go through a typed query spec. The fallback SQL path is
   parsed with `libpg-query` and must pass the allowlist validator (single SELECT, tenant relations only,
   allowlisted functions, no system catalogs, no locking/utility statements). It then runs in a
   `READ ONLY` transaction as the tenant's reader role, with a statement timeout and a row limit.
2. **Tenant isolation.** One Postgres schema plus dedicated reader/writer roles per workspace. Tenant data
   is never touched through the control-plane connection. AI-originated SQL always runs with
   `SET LOCAL ROLE t_<id>_reader` and `search_path` pinned to that schema only.
3. **No destructive change without explicit confirmation.** Every structural change is a versioned
   migration with a rollback path. Snapshot affected data before any destructive change.
4. **Uploaded content is untrusted data, never instructions.** Cell values, headers, sheet names, and file
   names are passed to the AI only inside clearly delimited data blocks, truncated and masked. AI outputs
   are schema-validated and cannot trigger writes without user approval.
5. **Never invent numbers.** Every number shown comes from an executed query. Narration uses placeholders
   that code fills from the result set. Any digit the model writes outside a placeholder fails validation.
6. **Be honest about uncertainty.** Assumptions (column meaning, metric definition, ambiguous wording) are
   always shown to the user.
7. **Secrets only in environment variables.** Never commit keys. Keep `.env.example` current.

## Observability

Log every AI call to `app.ai_calls` (task, prompt version, model, latency, input/output/cache tokens, cost,
workspace). Log every executed tenant query to `app.query_runs`. AI cost is tracked per workspace.
