# Architecture Decision Records

**Statuses:**

- **Accepted**: confirmed by the owner, or directly mandated by the brief.
- **Proposed**: the engineer's default, pending owner confirmation (see `docs/OPEN_QUESTIONS.md`).
- **Superseded**: replaced by a later ADR.

Template for new entries:

```
## ADR-NNN — Title
- Status / Date
- Context
- Options considered
- Decision
- Consequences
```

---

## ADR-001 — First vertical: Retail & Ecommerce sellers with messy data

- **Status:** Accepted (owner, 2026-10-13)
- **Context:** The brief named "Shopify and ecommerce store owners", with a default of "inventory-based
  retail and wholesale". Shopify exports are already structured, so a Shopify-only target weakens the
  "messy data → clean database" pitch and invites comparison with Shopify Analytics.
- **Options considered:**
  1. Shopify-only merchants.
  2. Shopify merchants plus their side spreadsheets.
  3. Any retailer or ecommerce seller with messy data (online, marketplace, physical shop, multi-channel,
     light wholesale).
  4. Wholesale/distribution.
- **Decision:** Option 3. The first pack is `retail`, "Retail & Ecommerce". Exports from Shopify, Etsy,
  Amazon, WooCommerce and common POS systems are recognised *formats* inside the pack. They are not the
  product's identity.
- **Consequences:**
  - The pack must handle denormalised order exports (order header repeated on every line), POS till exports,
    hand-kept stock lists, supplier orders, and expenses.
  - Light wholesale (invoices with payment terms) is in scope, because many small retailers also sell to
    stockists.
  - A dedicated wholesale/distribution pack is a candidate second pack.

## ADR-002 — TypeScript pnpm monorepo

- **Status:** Accepted (owner, 2026-10-13)
- **Context:** The safety-critical logic (compiler, validator, cleaning rules) must be testable outside
  Next.js and shared between web and worker.
- **Options considered:**
  1. A single Next.js app.
  2. A pnpm workspaces monorepo.
  3. Turborepo/Nx.
- **Decision:** A pnpm workspaces monorepo with these packages:
  - `apps/web`
  - `apps/worker`
  - `packages/db`
  - `packages/core`
  - `packages/ingest`
  - `packages/ai`
  - `packages/packs`

  Plain `pnpm -r` scripts at first; add Turborepo only if CI time becomes a problem.
- **Consequences:**
  - A little more setup in M0.
  - Clear dependency direction: `core` never imports `web`.
  - `ai` never imports `db` (tasks return data, callers persist).

## ADR-003 — Next.js App Router + Tailwind + shadcn/ui

- **Status:** Accepted (brief recommendation)
- **Context:** We need a fast-to-build, responsive, conventional UI.
- **Decision:**
  - Next.js App Router, latest stable at M0, pinned exactly.
  - Tailwind CSS and shadcn/ui components.
  - React Server Components for reads, server actions for mutations.
- **Consequences:**
  - Serverless-friendly web tier.
  - Long work must go to the worker (ADR-011).

## ADR-004 — PostgreSQL with a control-plane schema plus one schema per tenant

- **Status:** Accepted (brief recommendation, justified here)
- **Context:** Each business gets a *different*, AI-designed set of tables, which changes over time. A bug in
  AI output must never expose another tenant's data.
- **Options considered:**
  1. **Shared tables + `tenant_id` + Row-Level Security.** Doesn't fit dynamic per-tenant structures. We'd
     need EAV/JSONB storage, which makes queries slow and AI-generated SQL hard to validate.
  2. **Schema per tenant.** Native tables per business, simple SQL, isolation via schema privileges, and
     easy per-tenant snapshots and drops.
  3. **Database per tenant.** Strongest isolation, but expensive and operationally heavy at our stage.
     Neon branching makes it plausible later.
- **Decision:** Option 2. `app` holds the control plane, `t_<id>` holds tenant data, and `t_<id>_snap` holds
  rollback snapshots.
- **Consequences:**
  - Catalog bloat beyond a few thousand tenants per database. Mitigation: shard tenants across databases;
    `workspace` records its database.
  - Control-plane migrations (Drizzle) and tenant migrations (our engine) are separate systems.
  - Deleting a workspace is `DROP SCHEMA … CASCADE` plus control-plane cleanup.

## ADR-005 — Per-tenant database roles for query execution

- **Status:** Accepted
- **Context:** Safety rule 2 requires that AI output can never read another tenant's data. A shared
  read-only role is not enough, because it can read every tenant schema.
- **Options considered:**
  1. A single read-only role plus validation.
  2. Per-tenant NOLOGIN roles, assumed with `SET LOCAL ROLE` from a broker login role.
  3. Per-tenant LOGIN roles with their own credentials.
- **Decision:** Option 2 for the MVP:
  - `t_<id>_reader` and `t_<id>_writer` roles.
  - The `bizr_tenant` login role is NOINHERIT and has no privileges of its own.
  - Every query runs in a transaction with `SET LOCAL ROLE`, a pinned `search_path`, a `READ ONLY` mode
    (for reads), a statement timeout, and a row limit.
  - The control-plane role `bizr_app` has no tenant privileges.
- **Consequences:**
  - Residual risk: a validator bypass that changes role could cross tenants. Mitigated by AST-level
    rejection of utility statements and a function allowlist that excludes `set_config` and similar.
  - Planned hardening, option 3 (per-tenant login roles with short-lived credentials), recorded in
    OPEN_QUESTIONS.
  - The SQL validator has an adversarial test suite as an M4 acceptance criterion.
- **Amendment (2026-10-15, M1).** The isolation suite showed the residual risk was real:
  `SELECT set_config('role', 't_other_reader', true)` let a tenant role switch to another tenant's role
  within the transaction. Fixed at the database level:
  - `EXECUTE` on `pg_catalog.set_config` is revoked from PUBLIC and granted only to our four login roles
    (`pnpm db:setup`).
  - The executor sets `search_path` and timeouts *before* `SET LOCAL ROLE`.
  - Tenant roles therefore can't change any setting, including `role`. A test locks this in.
  - Note for hosted stages: the revoke needs superuser-level rights; verify on Neon before Stage 1
    (OPEN_QUESTIONS R16).

## ADR-006 — Drizzle for the control plane; our own migration engine for tenant schemas

- **Status:** Accepted
- **Context:** The control-plane schema is static and known at build time. Tenant schemas are dynamic.
- **Decision:**
  - Drizzle ORM and `drizzle-kit` for `app`.
  - Tenant DDL is produced only by the change-plan compiler (`packages/core/change-plan`).
  - Tenant DML (loads, merges, record edits) uses parameterised SQL built by `packages/core` with a single
    identifier-quoting helper.
- **Consequences:** Two migration histories. Tenant history lives in `app.migration` and is user-visible
  (in plain language) as "Change history".

## ADR-007 — Questions are answered through a semantic query spec, with validated SQL as fallback

- **Status:** Accepted
- **Context:** Safety rule 1. We also need reliable metric definitions: "profit" must mean the same thing
  every time.
- **Options considered:**
  1. LLM writes SQL directly.
  2. LLM fills a typed query spec over semantic metrics and dimensions.
  3. Both: spec first, SQL fallback.
- **Decision:** Option 3.
  - **The spec is the primary path.** It references metric ids, dimension fields, filters, time range,
    comparison, sort and limit, and it compiles deterministically.
  - **SQL fallback** is only used when the spec can't express the question (e.g. "customers who bought X
    but never Y"). It is parsed and validated, then executed under ADR-005 controls.
  - **Every answer records which path it took.** Evals track the fallback rate, aiming to shrink it by
    extending the spec.
- **Consequences:**
  - More upfront work building the spec compiler.
  - Consistent metrics across Ask, dashboards and insights, since all three use the same compiler.

## ADR-008 — Structural changes are typed change plans compiled deterministically

- **Status:** Accepted
- **Decision:**
  - The AI (and the ingestion pipeline) emits a `ChangePlan` (Zod schema).
  - A pure compiler produces the DDL, the catalog delta, an inverse plan, and an impact analysis.
  - Destructive operations require explicit confirmation and a snapshot.
  - Every application is recorded in `app.migration` with a version number.
- **Consequences:**
  - The AI cannot express anything outside the operation vocabulary. New capabilities require new
    operations, which is intentional.

## ADR-009 — Narration uses placeholders; code inserts every number

- **Status:** Accepted
- **Context:** Safety rule 5 ("never invent numbers"). Checking an LLM's free text against results after the
  fact breaks down with rounding, percentages and derived values.
- **Decision:**
  - Deterministic code extracts **facts** from the result into named values: totals, top/bottom items,
    shares, changes versus the comparison period, counts.
  - The narrator receives the facts and writes text using only `{{fact_id}}` placeholders.
  - Validation rejects any output that has digits outside placeholders or references unknown facts. One
    retry is allowed, then a deterministic template is used as fallback.
  - Code renders the values with workspace currency/locale formatting.
- **Consequences:**
  - Numbers are correct by construction.
  - The prose is slightly more constrained, which is acceptable.
  - Insight text and the review-screen summaries use the same mechanism.

## ADR-010 — Anthropic Claude via the official SDK, behind a provider interface, three model tiers

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - `@anthropic-ai/sdk`, wrapped by `LLMProvider` in `packages/ai`.
  - Tiers configured by env:

    | Env var | Default (current models as of 2026-10) | Used for |
    |---|---|---|
    | `AI_MODEL_STRONG` | `claude-opus-5-5` | Data-model proposals, change plans, hard questions |
    | `AI_MODEL_STANDARD` | `claude-sonnet-5-5` | Question interpretation, dashboard/record edits |
    | `AI_MODEL_FAST` | `claude-haiku-5-5` | Narration, insight phrasing, SQL explanations |

  - All outputs use structured outputs (`messages.parse` + `zodOutputFormat`), with adaptive thinking and
    a per-task `effort`.
  - Prompt caching on stable prefixes.
  - Server-side refusal fallbacks are enabled, and `stop_reason` is always checked.
- **Consequences:**
  - The provider can be swapped by implementing one interface.
  - Note: current Opus/Sonnet models reject forced `tool_choice`, so we use structured outputs instead of
    forced tool calls.
  - Prices are kept in a config table used for cost logging. They need updating when pricing changes.

## ADR-011 — Background jobs with pg-boss; worker mode or serverless "drain" mode

- **Status:** Accepted (owner, 2026-10-13; amended same day for the zero-cost rule, ADR-026)
- **Context:**
  - Ingestion, loading and insight runs take seconds to minutes.
  - Serverless functions are time-limited and can't host a long-running consumer.
  - A dedicated worker host costs money, and we must spend $0 until revenue (ADR-026).
- **Options considered:**
  1. **pg-boss + an always-on worker** (Railway/Fly/Render). Simple, but no reliable free host exists.
  2. **Inngest / Trigger.dev.** Hosted, with free tiers, but adds a vendor and changes the execution model.
  3. **BullMQ + Redis.** Adds Redis.
  4. **pg-boss with two runner modes.** A long-running worker where we have one (local dev, paid
     production), and an inline "drain" route in the free hosted preview. The drain route processes job
     steps within a time budget and is triggered by UI polling, `after()`, and a daily cron.
- **Decision:** Option 4.
  - Jobs are written as resumable, idempotent, checkpointed **steps**, each fitting within
    `JOB_STEP_BUDGET_MS`.
  - `JOB_RUNNER=worker|inline` selects the mode.
  - The same handler code runs in both modes.
- **Consequences:**
  - Slightly more design work per job (step boundaries, checkpoints). This also improves robustness and
    progress reporting.
  - In the free preview, background work only advances while a user is active or when the daily cron
    fires. That's acceptable for a preview.
  - Moving to paid production means starting the worker and setting `JOB_RUNNER=worker`. No code changes.

## ADR-012 — Auth with Better Auth

- **Status:** Accepted (owner, 2026-10-13)
- **Options considered:**
  1. **Better Auth.** Self-hosted in our Postgres, email/password + Google, an organization plugin for
     workspaces/invites.
  2. **Auth.js.** Mature, but history of breaking changes; organisations are DIY.
  3. **Clerk.** Fastest, but a paid vendor and user data lives outside our database.
  4. **Supabase Auth.** Implies the Supabase platform.
- **Decision:** Better Auth. Workspace membership is modelled in our own `workspace_member` table so we
  aren't locked to a plugin's model.
- **Consequences:** We own email sending for verification and reset.
  - Console logging locally.
  - Resend's free tier when hosted.
  - Email verification is not required to start using the product, so email delivery problems never block
    onboarding.

## ADR-013 — File storage abstraction

- **Status:** Accepted (owner, 2026-10-13; amended for ADR-026)
- **Decision:** A `Storage` interface with three drivers:
  - `local`: filesystem, for dev/test
  - `postgres`: `bytea` in `app.upload_blob`, for the free hosted preview. Bounded by the upload limits and
    the free database's storage quota, so it's fine for demo-sized files.
  - `s3`: S3-compatible (Cloudflare R2), for paid production

  Original uploads are immutable and content-addressed (sha256).
- **Consequences:**
  - Re-ingestion and audits are always possible.
  - The `postgres` driver is not for production volumes. Switching to `s3` is a config change plus a
    one-off copy script.
  - Retention: originals are kept for the life of the workspace.

## ADR-014 — File parsing: SheetJS + Papa Parse + encoding detection

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - **SheetJS** (installed from the official SheetJS CDN tarball, since the npm registry copy is outdated)
    for xlsx/xls/ods. It handles merged cells, Excel date serials, and number formats.
  - **Papa Parse** for CSV/TSV (streaming, delimiter sniffing).
  - **jschardet + iconv-lite** to detect and decode legacy encodings (Windows-1252, UTF-16 with BOM).
- **Consequences:**
  - Formulas use cached values only. We never evaluate formulas.
  - Very large files (> limits, ADR-024) are rejected with a friendly message.

## ADR-015 — Charts: Recharts with a fixed chart set and deterministic chart choice

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - Recharts via shadcn/ui chart components.
  - The chart set is fixed: `kpi`, `line`, `bar`, `bar_horizontal`, `stacked_bar`, `table`.
  - The chart type is chosen deterministically from result shape (rules in AI_DESIGN). The AI can only
    express a preference ("as a line chart") within valid options.
- **Consequences:**
  - Predictable, accessible charts.
  - No pie charts, except perhaps a later `donut` for ≤5-part shares.

## ADR-016 — Hosting in stages: local → free hosted preview → paid production

- **Status:** Accepted (owner, 2026-10-13; replaces the earlier "Vercel + Neon + Railway + R2 from day one"
  proposal)
- **Context:** The owner requires zero infrastructure spend until the product is in production and
  generating revenue (ADR-026).
- **Decision:** Three stages, switchable by configuration only (table in ARCHITECTURE §13).
  - **Stage 0 — Local ($0, default).** Docker Compose Postgres, local file storage, worker process. All
    development and the investor demo run here.
  - **Stage 1 — Free hosted preview ($0, optional).**
    - Web: Vercel Hobby, or Cloudflare/Netlify free if commercial-use terms are a concern (Q19).
    - Database: Neon Free.
    - Jobs: inline drain mode with a daily cron.
    - Files: Postgres storage driver.
    - Only built if a shareable link is needed before revenue.
  - **Stage 2 — Paid production (after revenue).**
    - Vercel Pro (or equivalent)
    - Neon paid
    - dedicated worker (Railway/Fly/Render)
    - R2
    - Sentry
- **Consequences:**
  - No vendor accounts are needed to build the product.
  - Free-tier limits and terms must be re-verified when Stage 1 is set up. They change often, and some
    hobby plans restrict commercial use.
  - Neon's pooler is in transaction mode, which is compatible with our `SET LOCAL` pattern. Never use
    session-level `SET`. Creating NOLOGIN roles and grants via SQL on Neon must be verified in M1.

## ADR-017 — Row identity and merge strategy for re-uploads

- **Status:** Accepted
- **Decision:**
  - Natural keys come from the pack, or the user confirms one. A row hash is the fallback.
  - Diffs are shown before applying.
  - Rows missing from a new file are never deleted automatically.
  - Conflicts with in-app edits are resolved by the user.
  - Merges are recorded in `record_edit` and can be undone.
- **Consequences:** Without natural keys, changed rows look like delete + add. These are routed to review.

## ADR-018 — Lineage, soft delete, and system columns in tenant tables

- **Status:** Accepted
- **Decision:**
  - Every tenant table has `_id`, `_natural_key`, `_row_hash`, source lineage
    (`_source_upload_id/_sheet/_row`), timestamps, and `_deleted_at`.
  - User deletes are soft.
  - The compiler excludes soft-deleted rows.
- **Consequences:**
  - "Where did this number come from?" can be traced back to a file row.
  - Hard deletes happen only via workspace deletion or retention jobs.

## ADR-019 — Testing strategy

- **Status:** Accepted
- **Decision:**
  - **Vitest** for unit tests:
    - compiler
    - validator
    - cleaning rules
    - merge
    - fact extraction
    - chart choice
  - **Vitest + a real Postgres** (Docker locally, service container in CI) for integration tests:
    - ingestion end to end with the AI stubbed by recorded fixtures
    - executor isolation
  - **Playwright** for key journeys.
  - **The `evals/` suite** measures AI accuracy against fixture files and question sets. It runs manually
    or nightly with a cost report, not on every PR.
- **Consequences:**
  - CI is deterministic and free of LLM costs.
  - AI regressions are caught by the evals before releases.

## ADR-020 — Mask PII in AI samples by default

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - Values detected as emails, phone numbers, or card-like numbers are masked in samples sent to the AI,
    preserving shape (`j***@g***.com`, `+1 ***-***-4821`).
  - Person names are not masked by default, because they're needed for dedupe reasoning.
  - Workspace setting `pii_masking` defaults to on.
- **Consequences:** Slightly less AI context for column classification. Detected column type (email/phone)
  is still passed.

## ADR-021 — Demo replay mode for AI calls

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - `AI_REPLAY_MODE=record|replay|off`.
  - In `replay`, workspaces flagged `is_demo` return recorded AI outputs keyed by
    (task, prompt version, input hash). They fall back to live calls on a miss.
  - Recordings are versioned in the repo under `evals/recordings/demo/`.
- **Consequences:**
  - The investor demo is resilient to network and latency problems.
  - We must label this honestly internally: it is a resilience mechanism, and the live path stays the
    default for real users.

## ADR-022 — Money and numeric handling

- **Status:** Accepted
- **Decision:**
  - `numeric(18,4)` in Postgres, decimal strings in transport, `decimal.js` for in-process maths.
  - One currency per workspace for the MVP.
  - Currency symbols in files are parsed and checked for consistency. Mixed currencies are flagged and
    never silently converted.
- **Consequences:** Multi-currency is in the roadmap.

## ADR-023 — Snapshots for destructive changes

- **Status:** Accepted
- **Decision:**
  - Before a destructive change or a lossy rollback, run `CREATE TABLE t_<id>_snap.<table>__v<N> AS TABLE
    t_<id>.<table>` for the affected tables, and record it in `app.snapshot`.
  - Default retention is 30 days, collected by `snapshot.gc`.
- **Consequences:**
  - Storage cost scales with tenant size. This is fine at SMB scale.
  - Neon branch-based snapshots are a possible later optimisation.

## ADR-024 — Upload and volume limits for the MVP

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - 25 MB per file.
  - 200k rows per sheet.
  - 20 sheets per workbook.
  - About 2M rows per workspace in total.
- **Consequences:** Covers the vast majority of SMBs. Limits are enforced with friendly messages and are
  configurable via env.

## ADR-025 — Locale handling: workspace currency, timezone and date order

- **Status:** Accepted (owner, 2026-10-13)
- **Decision:**
  - Onboarding captures currency (default USD), timezone (browser-detected), and date order (`DMY`/`MDY`,
    guessed from the browser locale).
  - The profiler uses date order to resolve ambiguous dates like `03/04/2026`. When the data itself
    contradicts the setting (e.g. `25/03/2026` under MDY), the profiler resolves it per column and records
    an assumption.
- **Consequences:** Fewer silent date errors, which are the most common real-world data bug.

## ADR-026 — Zero-cost operating rule until revenue

- **Status:** Accepted (owner, 2026-10-13)
- **Context:** The owner doesn't want to spend money on servers or services before the product is in
  production and generating revenue.
- **Decision:**
  - Only free options are used for infrastructure and tooling:
    - local development
    - free tiers (Neon Free, Vercel Hobby or equivalent, Resend free, GitHub Actions free minutes, Sentry
      free tier if used)
    - open-source libraries only
  - No paid add-ons or custom domains.
  - Any proposal that would cost money must be raised with the owner first, and logged here.
- **Exception: the AI API.** The Claude API has no free tier, and the product cannot work without it.
  Spend is kept to a minimum and hard-capped (ADR-027). The budget is an owner decision (OPEN_QUESTIONS
  Q18).
- **Consequences:**
  - The architecture gains runner modes (ADR-011), a Postgres storage driver (ADR-013), and staged hosting
    (ADR-016).
  - The investor demo runs locally.
  - Moving to paid production is a documented configuration change, tracked in PLAN's roadmap ("Production
    upgrade").

## ADR-027 — AI spend controls

- **Status:** Accepted (owner, 2026-10-13); budget amounts pending (Q18)
- **Context:** AI calls are the only unavoidable cost. We need to build, test and demo with minimal and
  predictable spend.
- **Decision:**
  1. **Hard spend guard.** `AI_BUDGET_DAILY_USD` and `AI_BUDGET_MONTHLY_USD` are checked against
     `app.ai_call` totals before every call. Over budget, the call is refused with a friendly message and
     deterministic fallbacks are used where they exist (narration templates, insight templates).
     Development defaults: $2 a day, $15 a month.
  2. **Record/replay everywhere it's safe.**
     - Unit and integration tests and CI **never** call the live API. They use recorded fixtures
       (`AI_REPLAY_MODE=replay`, with a miss treated as a test failure).
     - Local development records on first use and replays afterwards, by default.
  3. **Evals are run deliberately.** Only on demand (`pnpm eval --limit N`), with a cost estimate printed
     before the run and a confirmation prompt above $1.
  4. **Cheaper tiers where quality allows.**
     - Haiku for narration and phrasing.
     - Sonnet for interpretation.
     - Opus only for data-model proposals and change plans.
     - We test whether Sonnet at high effort is good enough for data modeling during M2. If it is, the
       default changes.
  5. **Prompt caching** on every stable prefix, and known-format fast paths that skip the AI entirely for
     recognised exports.
- **Consequences:**
  - Expected build-phase AI spend is a few dollars a month, which the evals will measure.
  - Live-API behaviour is exercised only by evals and manual testing, so evals must run before each
    milestone sign-off.

## ADR-028 — Toolchain versions for M0

- **Status:** Accepted (2026-10-13, engineering decision within approved scope)
- **Context:** M0 pins the toolchain. Some of the newest major versions don't work together yet.
- **Decision:**
  - **TypeScript 6.0.x, not 7.x.** TypeScript 7 (the native compiler) is the latest release, but
    typescript-eslint supports only `<6.1`. Revisit when typescript-eslint adds TS 7 support.
  - **Toolchain:**
    - ESLint 10 (flat config) with type-aware typescript-eslint rules
    - Prettier 3
    - Vitest 5
    - Playwright (latest)
    - Next.js 16.4 (Turbopack)
    - React 19
    - Tailwind CSS 4
    - Drizzle ORM 0.45 / drizzle-kit 0.31
    - pg-boss 12
    - Zod 4
    - pino 10
  - **Node.js:** 24 LTS in CI (`.nvmrc`). `engines` allows 22.12+ so existing machines work.
  - **Workspace packages export TypeScript source directly.** There is no build step. Next.js
    compiles them via `transpilePackages`; the worker and CLIs run with `tsx`.
  - **One set of `.env*` files at the repo root,** loaded with `@next/env` everywhere (web, worker,
    CLIs, tests), so precedence rules are identical across processes.
- **Consequences:**
  - Simple builds and fast iteration.
  - The worker runs TypeScript through tsx in production too. That's acceptable at our scale; it can
    be swapped for a bundled build later.

## ADR-029 — Generic `app.job_run` table and pg-boss usage

- **Status:** Accepted (2026-10-13)
- **Context:** ADR-011 needs checkpointed, resumable job steps that work in worker and drain modes.
- **Decision:**
  - **`app.job_run` stores each run's checkpoint:** input, `state`, `step_index`, progress, and a
    user-safe error. The feature-specific run tables in ARCHITECTURE §4 (`ingestion_run` etc.)
    reference a `job_run` row instead of re-implementing progress and status.
  - **A pg-boss job only means "advance run X".** When a run yields because its budget ran out, a
    continuation job is queued.
  - **Enqueueing is transactional.** The `job_run` insert and the pg-boss send happen in one
    transaction, via pg-boss's Drizzle adapter.
  - **pg-boss lives in a `pgboss` schema owned by the control-plane role.** The schema is
    pre-created by `pnpm db:setup`; pg-boss runs its own migrations on start.
  - **Maintenance:** the worker supervises (expiry, retention). In inline mode, the daily cron calls
    the drain route with `?maintenance=1`.
- **Consequences:**
  - A step failure marks the run failed. The user (or code) re-queues explicitly.
  - pg-boss retries (2, with backoff) only cover infrastructure errors around a step.

## ADR-030 — Vertical packs are compiled into a generated module

- **Status:** Accepted (2026-10-15)
- **Context:** Packs are authored as YAML (VERTICAL_PACKS §1). Reading YAML from disk at runtime breaks
  under bundlers (Next.js) and serverless file tracing.
- **Decision:**
  - `pnpm packs:build` validates all packs and writes `packages/packs/src/generated/packs.ts`. The app
    uses `getPack()` / `listPacks()` from that module.
  - The file-system loader is a separate entry point (`@bizr/packs/fs`) for CLIs and tests.
  - `pnpm packs:validate` (in CI) fails if the generated file is stale.
- **Consequences:**
  - No runtime file access and no YAML parser in the bundle.
  - Pack authors must run `pnpm packs:build` and commit the result.

## ADR-031 — Owner authorised building through the milestones

- **Status:** Accepted (owner, 2026-10-15)
- **Context:** The working conventions said to wait for owner confirmation between milestones.
- **Decision:**
  - The owner confirmed M0 and asked to "build everything for now".
  - Milestones continue back to back, each still meeting its acceptance criteria, with docs and CI
    green.
  - Steps that need the owner are batched for the end:
    - creating the Google OAuth client (`docs/RUNBOOK_GOOGLE_OAUTH.md`)
    - providing the Anthropic API key (needed for live AI in M2+)
- **Consequences:**
  - Progress is reported at each milestone boundary in PROGRESS.md rather than waiting for
    sign-off.
  - Anything that would cost money or change scope still goes to the owner first.

## ADR-032 — ExcelJS for Excel files (amends ADR-014)

- **Status:** Accepted (2026-10-15)
- **Context:** ADR-014 chose SheetJS from its official CDN tarball, because the npm copy is outdated. The
  CDN is not reachable from our build environment, and an outdated parser for untrusted files is not
  acceptable.
- **Decision:**
  - **ExcelJS** (MIT, maintained on npm) reads `.xlsx`/`.xlsm`.
  - Papa Parse and the encoding detection stay as in ADR-014.
  - Old binary `.xls` files get a plain-language "please save as .xlsx" message.
- **Consequences:**
  - Merged cells, cached formula values and date cells are handled by our own wrapper
    (`packages/ingest/parse/xlsx.ts`), which is unit-tested.
  - `.xls` support can come back later through a separate, sandboxed converter if users need it.

## ADR-033 — Data modelling: rules first, AI where needed

- **Status:** Accepted (2026-10-15)
- **Context:** AI_DESIGN Task A assumed the AI proposes every data model. That costs money on every
  upload, makes ingestion stop working with no key or over budget, and is slower (risk R7).
- **Decision:**
  - A deterministic proposer (`packages/core/ingestion/heuristic.ts`) always runs first. It uses the
    pack's header and value synonyms, known export formats and the column profiles to recognise the
    common retail layouts.
  - The AI (Task A) runs only when the rules leave a table unmapped or uncertain (`aiMode: 'auto'`). It
    receives the rule-based draft as a starting point.
  - Every AI proposal is validated against the pack and the profiles, gets one repair round (Task B with
    the validator's findings), and falls back to the rule-based proposal on any AI failure (no key, over
    budget, refusal, invalid output).
  - A refusal is retried once on the standard tier by our client code. This replaces the server-side
    refusal fallback in ADR-010, so all tiers and costs stay visible in `app.ai_call`.
- **Consequences:**
  - Recognised files, including the whole demo dataset, import with no AI cost and no API key.
  - Task A prompts and evals are still needed for unfamiliar files. The live AI path has only been
    tested with fake providers until the owner supplies a key (Q20).

## ADR-034 — Ingestion state: originals plus versioned proposals

- **Status:** Accepted (2026-10-15)
- **Decision:**
  - Every ingestion job step re-derives what it needs from the stored originals (parse → tables →
    profiles). Parsing is deterministic and fast, so job state stays small and any step can be re-run.
  - Each review change creates a new `model_proposal` version with:
    - `base_proposal`: what the AI or the rules produced
    - `corrections`: the owner's decisions, in order
    - `proposal`: base plus corrections, which is what gets shown and applied
    - `review`: dry-run counts, examples, skipped lines and warnings
  - Owner corrections are applied by code and re-applied after every AI revision, so the AI can't undo
    them.
  - A stale page can't act on an old version; only the newest draft can be revised or approved.
- **Consequences:**
  - Undo is just removing a correction and re-running the test.
  - Very large files are parsed several times per run. This is acceptable at the ADR-024 limits; cache
    the parsed grid if it shows up in timings.

## ADR-035 — Loading: parameterised batch inserts as the tenant writer

- **Status:** Accepted (2026-10-15)
- **Context:** PLAN M2 said "batch COPY". COPY needs a different code path, and makes per-row
  parameter typing harder to keep safe.
- **Decision:**
  - The loader inserts in link order (linked-to records first) with multi-row parameterised `INSERT …
    RETURNING _id`, in one transaction, as `t_<id>_writer` (through `withTenantWriter`, which pins
    `search_path` like the executor).
  - Links become `<field>_id` foreign keys; the original text is always kept in `<field>_ref`.
  - Money and decimals are sent as exact decimal strings.
  - Re-running a load is a no-op: the step first checks for records with this import's
    `_source_upload_id`.
- **Consequences:**
  - The demo dataset (about 20,000 records) loads in about a second. Revisit COPY if large imports
    approach the step budget.
  - The writer role still has no DELETE; undoing an import arrives with the merge engine.

## ADR-036 — Small structural choices made while building M2

- **Status:** Accepted (2026-10-15)
- **Decision:**
  - The demo generator is the workspace package `packages/demo-data` (`pnpm demo:generate`), not
    `scripts/`, so tests and evals can import it.
  - Natural keys compare names loosely (case, punctuation, "&"/"and", legal suffixes such as Ltd), which
    merges "Bloom & Co" and "BLOOM & CO LTD". Merges are always shown on the review screen, with a
    question for the most important group.
  - The S3 storage driver is deferred to the production upgrade (ADR-026). `local` and `postgres` cover
    development, tests and the free preview.
  - The ingestion queue names are `ingest.analyze`, `ingest.revise` and `ingest.apply`.

## ADR-037 — Metric IR additions and derived requirements (amends VERTICAL_PACKS §1.6)

- **Status:** Accepted (2026-10-16)
- **Context:** Several retail metrics aren't plain period totals: stock as of the latest count, dead
  stock, new or lapsed customers, and money owed. Shopify discounts are per order, but category
  breakdowns need them per item.
- **Decision:** The IR gains:
  - **windows** per aggregate: `period`, `to_end`, `all`, `{ last_days: N }`
  - **`latest`**: the most recent value per linked record (stock counts)
  - **`per` roll-ups with conditions**: e.g. count customers whose first order is in the period
  - **`days_between`** and **period bounds**, with an optional `offset_days`
  - **`allocate`**: shares a parent's amount (an order discount) across child records by weight
  - **named `expressions` and `filters`** in the pack
  - optional **`from` / `time`** overrides

  `requires` is no longer hand-written. A metric needs every detail outside a `coalesce`; parts
  inside `coalesce` are optional and drop out when missing. `requires_any` covers either/or metrics
  (discounts).
- **Consequences:**
  - Availability can't drift from the definition.
  - `{ period: end }` means the first day after the period (the "as of" date). Snapshot metrics
    therefore count whole days before it.

## ADR-038 — Query compiler shape

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - Each aggregate is its own CTE over its base record type, joining only many-to-one links, grouped
    by the breakdown. This avoids double counting.
  - Roll-ups group the inner aggregates by the per-record key plus the breakdown.
  - A CTE per period joins the aggregates on the breakdown (`IS NOT DISTINCT FROM`) and computes the
    metrics.
  - Comparisons join two such CTEs. Whole calendar months compare with the months before; any other
    range compares with the same number of days before.
  - Sums and counts of nothing are 0 inside arithmetic.
  - All values are parameters, allocated only when used.
- **Consequences:**
  - The SQL is longer than hand-written SQL but always correct for any combination.
  - A breakdown or filter that a metric can't reach (expenses by channel) is refused with a plain
    message instead of returning misleading numbers.

## ADR-039 — Semantic catalog storage

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - Links come from `app.field.references_entity`; there is no separate `relationship` table.
  - `app.metric` stores each workspace's measures with availability, the reason and renameable labels.
    `field.has_data` and `entity.record_count` are refreshed after every import (the last step of
    `ingest.apply`).
  - `v_<table>_enriched` views are dropped and rebuilt inside every change-plan transaction.
  - Renames change labels only and are audited.
- **Consequences:**
  - Query-time model loading reads only the control plane.
  - Availability is as fresh as the last import or change.

## ADR-040 — Question interpretation: rules first, then the AI, always checked by code

- **Status:** Accepted (2026-10-16)
- **Context:** Most owner questions are short and use the pack's own words ("sales last month",
  "top products by profit"). Sending all of them to the AI costs money (ADR-026/027) and adds latency;
  sending none limits what owners can ask.
- **Decision:**
  - A rule-based interpreter (`@bizr/core/ask`) reads measure and breakdown words from the pack, the
    owner's own values (channels, categories, product and customer names, from `field.top_values`)
    and time phrases. It reports whether it understood every word. When it did, its answer is used
    with no AI call.
  - Otherwise Task D (`interpret_question@v1`) runs on the standard tier. Values, renamed labels,
    readable relations and the conversation travel inside `<workspace_data>`; the pack catalog is
    cached. The answer has the same typed form as the rules' answer: query / clarify / sql /
    unanswerable.
  - Every answer, from rules or AI, is checked by code: ids exist, owner spelling of values is
    restored (an unknown value is an error when the value list is complete), the spec compiles, SQL
    passes the validator, unavailable measures become a "missing data" answer, assumptions with
    digits or jargon are dropped. One repair round with the problems, then one try on the strong tier.
  - Never two clarifications in a row: the second becomes the first option with an assumption.
  - If the AI can't help (no key, over budget, still invalid), the rules' best guess is used and the
    words it skipped are named in an assumption; with no guess, the owner is asked to rephrase.
  - Time ranges are presets resolved by code in the workspace calendar (`ask/time.ts`); answer titles
    are written by code from the spec.
- **Consequences:**
  - The common questions cost nothing and answer instantly; the AI handles the long tail.
  - The rules can be wrong while "confident": the question eval set (M4) measures both paths, and
    any rule miss becomes a test.

## ADR-041 — Answers: facts, code-written fallbacks, stored answers and tiles

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - Every answer is built from the query result by code: facts (values, top three, changes, counts)
    with exact decimal money; the AI (Task E, fast tier) only writes a template with placeholders.
    It must pass the placeholder, digit, sentence-count, causal-claim, markdown and jargon checks,
    with one retry, or code's own template is used. The AI never sees result values.
  - "How I calculated this" is written by code from the spec and the pack's definitions; the SQL and
    row count sit under "Details". Fallback SQL gets Task F steps (checked for digits and jargon), or
    generic plain steps.
  - The chart comes from the result's shape (AI_DESIGN §5); a requested chart is used only if it fits.
  - `app.conversation` / `app.answer` store each question with its interpretation and the rendered
    answer (result capped at 200 rows). Follow-ups use the last six interpretations as context.
  - `app.dashboard` / `app.dashboard_tile` store pinned questions as specs. Tiles re-run live and keep
    their own dates only when the question named fixed dates. M5 builds on these tables.
  - The Ask screen and tiles render a view model formatted on the server, so the browser never
    formats money itself.
  - Tenant tables are `ANALYZE`d after every load: without statistics a fresh table looks empty and
    joins can take tens of seconds.
- **Consequences:**
  - Answers work fully without AI; the AI only improves wording and understanding.
  - Stored answers read back without re-running; tiles always show current data.

## ADR-042 — Dashboards: pack tiles, edit ops, versions and live tiles

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - The pack's `dashboard.yaml` defines the default dashboard (VERTICAL_PACKS §2.6). Tile 11 ("kpi +
    table") is two tiles: a number and a list.
  - `ensureDefaultDashboard` runs after every import (and on first visit). It adds pack tiles the data
    can now show, never ones already there or removed by the owner (`settings.removedPackTiles`).
    Tiles whose measures aren't available are left out, and an "Unlock more" card gives the reasons.
  - Every change, from chat, the tile menu or "Add to dashboard", is a list of typed edit ops
    (add / remove / update / move). `applyDashboardEdit` checks each one (every question compiles
    and is available, the tiles exist) and saves the whole dashboard as the next
    `dashboard_version`. Undo restores the version before, as a new version.
  - Tiles follow a global date range (presets) and a compare toggle. Comparisons apply to headline
    numbers. Over-time pack tiles go monthly above 120 days. Tiles with their own dates keep them
    and show a calendar badge.
  - Tile results are cached in memory per server instance, keyed by the workspace's `data_version`
    (bumped by every import), the day, the tile's question and its chart.
  - On dashboard tiles, blank groups ("Not recorded") are left out with a note; Ask keeps them.
  - Chat edits (Task G) work like Ask: a rules planner first (add a chart of…, remove, rename, move,
    show as…, show monthly), then `plan_dashboard_edit@v1`. The AI names tiles by short refs, which
    code maps back to ids. One repair round. Ambiguous targets get "Which one…?" with tile choices.
    A preview runs the new or changed tiles, and Apply checks everything again on the server.
  - Layout is a 12-column CSS grid sized from each tile's width. It can be changed from the tile menu
    (wider / narrower, move to top / bottom) instead of drag and drop (react-grid-layout was the
    plan's cuttable item).
- **Consequences:**
  - A new workspace lands on a full dashboard with no AI and no setup.
  - Every dashboard change is reversible and reviewable.
  - The cache is per instance; on the serverless preview each cold start runs tiles again.
