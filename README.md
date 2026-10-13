# BizRetriever

The AI business analyst for small retailers and ecommerce sellers. Upload messy spreadsheets and get a
clean data model, plain-language answers, an automatic dashboard, and proactive insights.

**Status:** M0 (foundation) is in progress. See [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Quick start (local, free)

Requirements: Node 24 LTS (22.12+ works), pnpm 10 (`corepack enable`), and Docker (or any local
Postgres 16+).

```bash
cp .env.example .env               # dev defaults; set JOB_DRAIN_SECRET (openssl rand -hex 32)
docker compose up -d               # Postgres 17 with `bizretriever` and `bizretriever_test` databases
pnpm install
pnpm db:setup && pnpm db:migrate   # creates database roles, then the control-plane tables
pnpm dev                           # web app on http://localhost:3000
pnpm dev:worker                    # background worker (second terminal)
```

Check it works: open http://localhost:3000, and `curl localhost:3000/api/health` should say the
database is `up`. `pnpm --filter @bizr/worker enqueue:noop` queues a test job that the worker
completes.

### Tests

```bash
# One-time: point tests at the test database.
sed -e 's#/bizretriever$#/bizretriever_test#' -e 's/^NODE_ENV=.*/NODE_ENV=test/' .env > .env.test.local
pnpm db:setup:test && pnpm db:migrate:test

pnpm test                          # unit + integration (integration tests skip if no test DB)
pnpm build && pnpm test:e2e        # Playwright smoke tests (desktop + mobile)
pnpm lint && pnpm typecheck && pnpm format:check
```

If Playwright can't download browsers, point it at a local Chromium with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js app: UI, API routes (`/api/health`, `/api/jobs/drain`) |
| `apps/worker` | Background job worker (pg-boss) |
| `packages/platform` | Env config (Zod), logging (pino + correlation ids) |
| `packages/db` | Control-plane schema (Drizzle), migrations, database roles and pools |
| `packages/core` | Deterministic engine. Today: the step-based job framework |
| `packages/ingest`, `packages/ai` | File ingestion and AI layer (M2) |
| `packages/packs` | Vertical pack format, loader, validator, and the `retail` pack |

## Docs

- [`CLAUDE.md`](CLAUDE.md): standing instructions, stack, commands, safety rules
- [`docs/PLAN.md`](docs/PLAN.md): milestones and tasks
- [`docs/PROGRESS.md`](docs/PROGRESS.md): current status and session log
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DECISIONS.md`](docs/DECISIONS.md),
  [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md), [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md),
  [`docs/VERTICAL_PACKS.md`](docs/VERTICAL_PACKS.md), [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md),
  [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md)
