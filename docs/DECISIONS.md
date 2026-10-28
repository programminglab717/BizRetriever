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

## ADR-043 — Re-upload merge, the record edit log, and editing records

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Recognising files.** Every imported sheet is remembered as an `app.data_source`, keyed by its
    header signature (normalised headers) and sheet name, with the mapping the owner approved. A
    workspace that already has data starts a `reupload` run. Sheets seen before reuse their approved
    mapping, and the review says "This looks like a newer version of …".
  - **Merge preview.** After review, the run stops in `merge_review` with a stored preview. The
    pure engine (`@bizr/core/merge`, `diffRecords`) sorts every record into new, changed, unchanged,
    missing and conflicts. Records match by natural key, or by content when they have no key.
    Values are compared by meaning: numbers without trailing zeros, date-times as instants (a
    date-time without an offset is read in the workspace's time zone, by Postgres, as the loader
    did).
  - **Never delete, never blank.** "Update my data" only inserts and updates. Records missing from
    the new file are listed and kept. "Missing" only covers records from the same source. A blank
    cell never overwrites a value.
  - **Conflicts.** A field changed in the app (grid or chat) since the record was last updated by an
    import is a conflict. The owner chooses "Keep yours" or "Take the file's"; unanswered conflicts
    keep theirs.
  - **The edit log.** Every app write to tenant records is logged in the tenant's own
    `_record_edit` table: insert, update, delete or restore, before and after (by column), origin
    (`grid` / `chat` / `reupload`), user, and batch. It is written in the same transaction as the
    change. A merge is one batch (its run id). Undo replays a batch backwards. It refuses when a
    later, not-undone edit touched the same records. The table is not in the semantic catalog, so
    questions and the SQL fallback can't read it.
  - **Editing records.** My data reads as the tenant reader role and writes as the writer role (no
    DELETE grant): delete is soft (`_deleted_at`), with "Recently deleted" for 30 days. Typed values
    are checked by `parseEditValue` (plain-language errors). Links are chosen from a search and
    stored as id plus display text. Each edit returns an undo handle. Undoing a file update happens
    from the import's page, not the toast. Every write bumps `data_version`, so cached tiles
    refresh.
  - The grid is our own table, virtualised with `@tanstack/react-virtual` (MIT, free). Server-side
    sort, search and filters made TanStack Table unnecessary.
- **Consequences:**
  - A whole update, or any single edit, can be undone exactly. Nothing an owner did afterwards is
    silently lost.
  - The writer role can update `_record_edit` (undo sets `undone_at`). It is an audit aid, not a
    tamper-proof log; `app.audit_event` records each merge and undo.

## ADR-044 — Structural changes: more ops, impact from the data, snapshots and an undo stack

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - New change-plan ops:
    - `rename_entity`, `rename_field`, `add_allowed_values` and `remove_allowed_values` change only the catalog.
    - `change_field_type` converts in place with `USING` expressions that never fail half way. `pg_input_is_valid` decides what can be read; anything unreadable becomes blank.
    - `remove_relationship` drops the link and keeps the linked record's name as text.
  - Conversions are classed as lossless (e.g. whole number → number, anything → text, date → date and time) or lossy (anything that can blank, round or truncate). Lossy ones are destructive. They are refused on required details and on the detail that dates the records.
  - The compiler returns, per plan:
    - `destructive`
    - an `inverse` plan when one exists
    - `snapshotTables`: the existing tables a destructive op changes
  - Removing a detail used in a natural key, or the time field, is refused with a plain reason.
  - **Snapshots (ADR-023):**
    - Before a destructive change, `applyChangePlan` copies the affected tables to `t_x_snap.<table>__v<N>` in the same transaction, and records the copy in `app.snapshot`, kept 30 days.
    - `snapshot.gc` drops expired copies. It is registered and can be queued (`pnpm --filter @bizr/worker run snapshot:gc`). The daily schedule arrives with M7's platform cron.
  - **Impact** (`analyzeChange`) is counted from the tenant data as the reader role:
    - records affected
    - values that won't convert
    - measures that would stop working: availability compared before and after, by name in this workspace
    - dashboard charts that use them
  - **Confirmation:** destructive changes need the removed item's name typed.
  - **Undo:** only the latest change can be undone, and never the set-up from files (imports are undone from their own page).
    - `compileRollback` replays exact inverses where they exist, and restores from the snapshot for what was removed or rewritten.
    - Restores cover details, whole record types (same ids, sequence moved on), links and values.
    - The undo is itself a new migration (`undoes_version`) and snapshots anything it removes.
    - Before undoing, the owner is told exactly what data entered since would be affected, and must confirm.
  - Every migration stores the catalog before it (`catalog_before`) and who made it.
- **Consequences:**
  - Every op has an integration test: apply, check, undo, check that the data is the same.
  - Measures defined by the owner (`add_metric`) stay out: metric definitions live only in pack `metrics.yaml` (CLAUDE.md). Renaming a measure is done in "What we track".
  - Text → date and time conversion reads the text in the admin session's time zone (UTC). It is rare and only offered with a snapshot.

## ADR-045 — Adding and changing by chat (Tasks H and I), and Ask's hand-off

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Planning order.** Both tasks run rules first, then the AI: `plan_record_write@v1` and `plan_change@v1`, at standard tier with low effort.
  - **Rules.** They read the common phrasings:
    - sales with items, quantities, prices, customers, dates and channels
    - new products, customers, suppliers, places and expenses
    - one-detail updates and status changes
    - new details (with the kind guessed from the words, or "as a number"), new record types, renames, kinds, allowed values, removals and unlinking
  - **Name lookups.** Records named in a request are found by a loose word match (`lookup.ts`).
    - One match is used.
    - Several matches get "Which … do you mean?" with the choices.
    - None makes a new customer, supplier or place, always shown on the card as new. It never creates a product.
  - **The AI's limits.** The AI sees only records whose names appear in the request (inside the data block), and may use only those ids. One repair round per task.
  - **Never remove unasked.** Code rejects any plan that removes data unless the request asked to remove, unlink or change something.
  - **Cards.** Code renders every card from the checked plan:
    - values (parsed by the field type)
    - defaults it looked up and states as assumptions: today, completed, the product's selling price and cost
    - totals it computed
    - before → after for updates
    - the impact summary for changes
  - **Writes.** Record writes run as the tenant writer in one logged batch (origin `chat`), so the toast's Undo removes them again. Structure changes go through `makeStructuralChange` (ADR-044).
  - **Where it lives.** One box on My data, "Add or change something", routes by the rules and then by wording. Ask checks the same rules first: a change request gets "That sounds like a change to your data" with a link that pre-fills the box (`?do=`), instead of an answer to a different question.
- **Consequences:**
  - The eval sets score the rules alone on every CI run, with nothing unintended allowed:
    - record writes: 44 cases, 100%
    - change plans: 33 cases, 100%
  - The rules were tuned on these cases, so the AI runs (Q20) should add unseen phrasings.

## ADR-046 — Member invites and roles

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - Owners invite by email from Settings → People. The link:
    - carries 32 random bytes; only their SHA-256 is stored in `app.workspace_invite`
    - works once, for the invited address only, for 7 days
    - is replaced by a newer invite to the same address
  - Zero-cost rule: the email is sent only when `RESEND_API_KEY` is set, and logged otherwise. The owner always gets the link to copy and share another way.
  - The invite page shows the business and who invited, then leads through sign-up or sign-in (`?next=`) to "Join". Accepting needs the signed-in email to match the invitation.
  - Roles stay `owner` and `member`. Members can do everything except inviting, removing people and deleting the business (PRODUCT_SPEC §5). That includes changing records and what's tracked: every change is undoable and logged with who made it. The checks are in core (`NotAllowedError`), not only the UI.
- **Consequences:**
  - Removing a member deletes only the membership; their account and their logged edits stay.
  - Finer roles (view-only, no structural changes) can be added later without changing invites (Q21).

## ADR-047 — Insight rules: a typed pack format and a pure evaluator

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Rules live in the pack** (`packs/retail/insights.yaml`, schema in `@bizr/packs` `insights.ts`). Each rule:
    - asks one or more questions: query specs with dates relative to today (`last_days`, `days_ago`, `to_date`). Today itself isn't included, because its sales aren't all in yet.
    - decides with small typed expressions over the answers: arithmetic, `pct_change`, `share`, `total`, and `last`/`prior` for date series
    - fills a trusted template. Every number is a `{{fact}}`, `{{n|one|many}}` picks a word, and `**…**` marks bold.
  - **Checks across files** (`checkInsights`, run by `packs:validate` and CI) reject:
    - unknown measures, questions, breakdowns, facts and thresholds
    - `__prev` without a comparison
    - summary-only facts in per-row rules
    - digits outside placeholders in templates and context lines
  - **The engine is industry-agnostic and pure** (`@bizr/core/insights` `evaluate.ts`, `render.ts`): rule + rows + thresholds go in, candidates with typed facts come out.
    - Rows with a blank key (unlinked, unnamed) are skipped.
    - A candidate with any missing fact is dropped, never shown with a hole.
  - **Arithmetic:** ratios and comparisons use doubles. Money facts read straight from a result, or summed over rows, keep Postgres's exact decimal string (`exact`), and are formatted from it.
  - **Severity score** = level weight (urgent 100, warn 10, info 1) × (1 + log10(1 + impact)), where impact is money or units at stake. Urgency always comes first; money orders within a level.
  - **Identity:** the fingerprint is rule + key (lower-cased) + any words a rule chose ("up"/"down").
  - **Retail rules differ from VERTICAL_PACKS §2.7 where the demo showed noise:**
    - `customer_slipping` also needs a usual spend of $200 per two months, so small occasional buyers aren't "regulars"
    - `rising_star` leaves out wholesale orders (one stockist order isn't a trend) and needs 25 units, not 10
    - the reorder suggestion is the stock-out card's context line, not a separate card
- **Consequences:**
  - A new vertical writes rules in YAML with no engine change.
  - The LLM never decides whether something is an insight (AI_DESIGN §7).

## ADR-048 — Insight storage, lifecycle and triggers

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Tables:**
    - `app.insight`: one row per fingerprint, with facts, rendered headline/context segments, action, status (`new`/`seen`/`dismissed`/`resolved`), feedback and timestamps
    - `app.insight_setting`: per-rule toggle and thresholds, clamped to the pack's range
    - `app.insight_run`: what ran or was skipped and why, history days, and the data version the run used
    - `app.digest`: one per workspace per week
  - **Lifecycle** (one transaction per run, under an advisory lock per workspace):
    - Found again: refreshed.
    - Not found by a rule that ran, was switched off or can't run: `resolved`. A rule that failed leaves its insights alone.
    - Dismissed: stays hidden while it holds, unless it gets more serious than when dismissed.
    - Resolved and back within the rule's `cooldown_days`: shown again without the "New" badge.
  - **Triggers:**
    - `ingest.apply` and `ingest.merge` end with an insights step that never fails the job.
    - Record edits, chat writes, structural changes and their undos queue `insights.run`. Debouncing is a coalesce rather than a delay: at most one waiting run per workspace. A delayed job would never be due in inline (serverless) mode until the next drain.
    - Home queues a run when there was none, or when the data version or the business's day moved on since the last one.
  - **Daily:** `scheduleDailyJobs` queues `insights.daily` (every active workspace, checkpointed per workspace) and `snapshot.gc` at most once per UTC day. It is called by the drain cron (`?maintenance=1`) and hourly by the worker.
  - **Digest:** the weekly digest (`digest.weekly` in ARCHITECTURE) is written by the first insight run of each week, rather than by its own job. It covers the last full week against the one before, the top 3 new insights and one suggested question.
- **Consequences:**
  - Insights follow every data change in both job modes with no extra infrastructure ($0).
  - A run is about ten small read-only queries through the executor (origin `insight`, logged in `app.query_runs`).

## ADR-049 — Task J: optional rewording of insights

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - `phrase_insights@v1` (fast tier, low effort) runs once per run, for up to ten newly created insights.
  - The AI sees only the pack sentence, the rule's topic and what kind of value each placeholder holds. No values from the owner's files are sent.
  - **Checks:** a rewording must keep exactly the same placeholders, and have no digits, advice or "why", markup, exclamation marks or jargon, in at most two sentences. Code puts the pack's bold back.
  - **Storage:** an accepted rewording is kept (`phrased_template`, `phrased_by`) and refilled with fresh facts on later runs, with no new call.
  - Any AI trouble keeps the pack sentence, which is also what shows until the API key arrives.
- **Consequences:**
  - Cost is bounded to one fast call per run that finds something new.
  - Tests use fake providers; the faithfulness eval waits for the key (Q20).

## ADR-050 — Insight correctness: knowable truth and a control business

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Control business:** the demo generator gains `stories: false`, the same business with no planted stories. M7's acceptance test loads both through the normal import path. On the demo it checks every story's numbers against `ground_truth.json`; on the control it checks there are no urgent alerts and none of the story rules fire.
  - **Knowable truth:** where the ground truth used something the files can't show, it gains a figure computed from what the files do show, with its definition next to it:
    - return rate counting returns on the day they came back
    - overdue money with part-paid invoices counted in full (files carry a "Paid?" flag but no amount paid)
    - channel shares after refunds, where till refunds have no channel
  - **Demo data:** with stories on, the generator's output is unchanged, so earlier tests keep their numbers.
- **Consequences:**
  - The acceptance test (`insights.int.test.ts`) fails if any story is missed, mis-numbered, or the control raises an urgent alert.

## ADR-051 — The demo shop and the demo machine

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Generated for today.** The demo shop (`@bizr/core/demo`) is Fernwood Home & Gift, generated for today in its own time zone and brought in through the normal import. The rules path only, so no AI is needed. The stories are therefore always current, whatever the demo day. Fixed-date checks stay where they belong: the M7 acceptance test uses 2026-10-13.
  - **"Try the demo shop"** (onboarding, and More/Settings → "Your businesses") makes a fresh demo shop and starts its live import, so people see exactly what happens with their own files.
    - Demo shops carry `workspace.is_demo` and a "Demo" badge.
    - Starting again replaces the person's previous demo shop.
  - **`pnpm demo:up`** does the presenter's setup in one command:
    - starts Postgres if needed, then sets up roles and migrations
    - makes the demo sign-in (`DEMO_EMAIL` / `DEMO_PASSWORD`; the password is hashed with Better Auth's own function)
    - resets tab A (empty) and tab B (already imported, insights included)
    - writes today's files and next month's export to `demo-files/`
    - starts web and worker with `AI_REPLAY_MODE=replay`
    - prints the day's import counts and Home's insight sentences for the script
  - **Spellings:** a merged customer keeps the spelling used most often ("Bloom & Co", not a one-off "Bloom and Co."). The generator gives each stockist's own spelling three times the weight, using the same random draws.
  - **Noisy rules:** stockist invoices are left out of the weekly sales change, as they were from "Products taking off" (ADR-047). One invoice swings a week on its own.
- **Consequences:**
  - The automated rehearsal (`e2e/demo.spec.ts`) runs the whole script from "Try the demo shop" to next month's file with AI off. It took 38.5 s and 33.1 s of machine time in two runs in a row.
  - Each "Try the demo shop" makes a tenant schema; the reset keeps it to one per person.

## ADR-052 — Quality gates for the demo: copy, small phones, accessibility, speed

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - **Copy linter** (`apps/web/src/copy.test.ts`, runs with `pnpm test`). It checks JSX text, shown attributes and sentence-like strings in every web source file with the same `findJargon` the AI's text is checked with. The admin page is exempt, and "Join" (a business) is allowed.
  - **Quality e2e** (`e2e/quality.spec.ts`) signs up, imports the demo shop and opens eleven main pages at iPhone SE size (375 × 667). It fails on any sideways scrolling, and on any serious or critical axe-core finding (WCAG 2 A/AA).
  - **Fixes it found:**
    - darker helper text (`--muted-foreground`)
    - urgent badge contrast
    - Ask's suggestion chips now wrap (the button base class stopped them shrinking)
    - links inside text are underlined
  - **Speed:** `pnpm perf <slug>` measures LCP on the main pages and Ask's time to answer on the production build. On the demo shop (2026-10-16):

    | Measure | Result | Target |
    |---|---|---|
    | Home LCP | p50 188–208 ms | ≤ 2 s |
    | Ask | p95 250–298 ms | ≤ 6 s |
    | Dashboard tile queries | p95 154 ms (`app.query_run`) | ≤ 1.5 s |

  - **Indexes:** tenant tables already index every link and date field. Control-plane tables are looked up by run or dashboard ids, which are indexed. No new indexes are needed.
- **Consequences:**
  - New pages are covered by adding them to the quality spec's list.
  - Ask timings with the AI on are still unmeasured (R22).

## ADR-053 — The internal admin page

- **Status:** Accepted (2026-10-16)
- **Decision:**
  - `/admin` is shown only to `ADMIN_EMAILS`; anyone else gets "not found".
  - It reads control-plane logs only:
    - AI spend today and this month against the caps, and per business
    - AI calls by task: live, replayed, failed checks, errors, blocked (budget or no key), p50/p95 latency
    - query latency and errors by origin and path (7 days)
    - background job failures (7 days)
    - the rules-only eval baselines from `evals/baselines/`
  - No tenant data is shown.
- **Consequences:**
  - The weekly cost and quality check needs no database access.
  - Once the AI key is in use, the "failed checks" rate is the early warning for prompt problems.

## ADR-054 — Running on managed Postgres without a superuser

- **Status:** Accepted (2026-10-26)
- **Context:**
  - Managed Postgres hosts (Neon for Stage 1, and most paid hosts for Stage 2) give a console owner role with `CREATEROLE`, not a true superuser.
  - `db:setup` assumed a superuser in three places:
    - restating `NOSUPERUSER` on roles
    - creating the job-queue schema for another role, and setting that role's default privileges
    - taking `set_config` away from PUBLIC
  - On a non-superuser host the last one is silently ignored: Postgres only warns about a non-owner's `REVOKE`.
  - `set_config` is defense in depth. It stops a tenant statement from switching to another tenant's role, because the broker login is a member of every tenant role.
- **Decision:**
  - **`db:setup` has a managed mode,** picked automatically when it isn't run by a superuser:
    - it leaves `NOSUPERUSER` out
    - it grants itself membership of the roles it creates (`WITH INHERIT TRUE, SET TRUE`)
    - it checks whether `set_config` is still open to PUBLIC, rather than trusting the `REVOKE`. Open is an error with a superuser, and a printed note without one.
  - **The executor checks the session after every tenant statement.** It records role, search path and statement timeout before the statement and compares them after. A change rolls everything back, returns nothing, logs an error and fails as "permission denied".
    - Within one statement, the tables' permissions are checked before anything runs, so a switch can only matter to later statements. There are none: one statement per transaction.
  - **The remaining gap on managed hosts:** one statement that switches role and then runs dynamic SQL (`query_to_xml` and similar). The SQL validator's function allowlist blocks it, as it always has.
  - **Before real customers' data sits on a host without a superuser,** build per-tenant login roles (ADR-005 option 3, on the roadmap). Then the broker isn't a member of other tenants' roles at all. It is now a prerequisite in `docs/RUNBOOK_PRODUCTION.md`.
  - **Stage 1 preview is ready** apart from the accounts: `apps/web/vercel.json` (daily cron), `pnpm preview:check`, and `docs/RUNBOOK_PREVIEW.md`. It is for demo data only.
- **Consequences:**
  - The same setup works on local Postgres, CI and Neon.
  - A Neon-like database was simulated locally: an owner role with `CREATEROLE` and `CREATEDB` only, owning the database. It passes the full suite (707 tests), `preview:check`, and the demo rehearsal on a production build with Postgres file storage and inline jobs.
  - The isolation test accepts either refusal: the database's or the executor's.

## ADR-055 — Per-business database logins

- **Status:** Accepted (2026-10-26). Builds ADR-005 option 3 and closes the gap ADR-054 left on managed Postgres.
- **Decision:**
  - **One login per business.** With `TENANT_LOGIN_SECRET` set, every business has its own database login, `t_x_login`. Its grants:
    - its reader and writer roles, `WITH INHERIT FALSE, SET TRUE`: it may *become* them but holds none of their rights itself
    - a group role, `<broker>_logins`: CONNECT, and `set_config` where it can be locked
  - **The executor and the writer connect as that login.** So no statement can switch to another business's role, even where `set_config` is open: Postgres refuses with "permission denied to set role". Without the secret, the shared broker login is used, as before.
  - **No stored passwords.** Each password is an HMAC of the login's name under the secret.
  - **Creation and repair:**
    - provisioning creates the login; deleting a business drops it
    - `connectTenant` makes or refreshes a missing or stale login on first use
    - `pnpm --filter @bizr/worker run tenant-logins` switches existing businesses over and takes the broker out of their roles. Run it again after changing the secret, which is how passwords rotate.
  - **Setup:** `db:setup` creates the group and gives the admin role ADMIN on it, so the admin can add new logins.
  - **Connections:** one small pool per business (at most 3 connections, closed after 10 s idle), with the 32 most recently used kept. Each login also has a database-side limit of 10 connections. Behind a pooler (Neon) this is cheap.
- **Consequences:**
  - **Tested on both kinds of database.** The isolation suite connects as one business's login and fails to reach another business, or even its own data without becoming its reader. It also checks a missing login is remade. On a Neon-like database (no superuser), the full suite (709) passes with logins on, and `preview:check` reports the stronger state.
  - CI runs with logins on, as production will. A run with them off keeps the fallback covered.
  - `TENANT_LOGIN_SECRET` is now required before real customers' data, wherever we host.

## ADR-056 — Downloads: answers, tiles and all records

- **Status:** Accepted (2026-10-26). M9.
- **Context:** Owners need their numbers in a spreadsheet (for an accountant, a supplier, a bank) and a way to take all their data with them. Every number must still come from an executed query, and cell text came from uploaded files, so it is untrusted.
- **Decision:**
  - **What can be downloaded:**
    - **An answer:** CSV or Excel, from the answer card ("Download: Excel · CSV"). It holds the rows the owner saw, as stored with the answer (up to 200). It does not re-run the question, which could pick up newer data or different dates. When the answer had more rows, the About tab says so.
    - **A dashboard tile:** CSV or Excel, from the tile's menu, run for the dashboard's dates.
    - **All my data:** one Excel workbook from My data, with one tab per kind of record (up to 100,000 records each, read in batches by id). Linked records show by name and coded values by their label. It is logged as `data.downloaded`.
  - **Values, not text:**
    - Money stays exact in CSV, as Postgres's decimal string.
    - Percents are written as percent numbers in CSV, with "(%)" in the header, and as fractions with a percent format in Excel.
    - Dates are real dates in Excel.
    - Money headers name the currency, for example "Net sales (USD)". Excel stores every number as a double, which keeps cents exactly at any realistic size.
  - **Formula injection:** in CSV, text starting with `= + - @`, a tab or a carriage return gets a leading `'`. Excel files store text as text and need no guard.
  - **About this file:** each Excel file has this tab: the question, dates, comparison, assumptions (rule 6), what was left out, and when it was made.
  - **Code:**
    - `@bizr/core/export` builds the sheets and uses `exceljs`, already a dependency of the ingest package.
    - Route handlers: `/api/w/<slug>/answers/<id>/download`, `/dashboard/tiles/<id>/download` and `/data/download`. Each checks session and membership (`workspaceForApi`) and answers 404 otherwise.
- **Consequences:**
  - No new service, and no cost.
  - Large shops beyond 100,000 records of one kind get the first 100,000. The About tab says so.
  - A streaming export can come later if anyone needs more.

## ADR-057 — Emailing the weekly summary and urgent alerts

- **Status:** Accepted (2026-10-26). M9.
- **Context:** Proactive insights only help if the owner sees them. Most owners won't open the app every day.
- **Decision:**
  - **What is sent:** after every insight run (import, re-upload, edit, settings change and the daily check), `sendInsightEmails` sends:
    - **the weekly summary,** once per person per week: the Home digest's numbers, top insights and a question to try
    - **urgent alerts,** once per person per insight, for urgent insights first seen in the last 24 hours. Several at once share one email; turning emails on later never sends old alerts.
  - **Who gets them:** active members whose email address is confirmed, not addresses someone else typed in. Demo shops send nothing.
  - **Choices:** each person chooses per business in Alert settings → "Emails to you". Both are on until turned off; no row means the defaults (`app.email_preference`).
  - **Unsubscribe:** every email has a one-click unsubscribe link, signed with an HMAC of business, person and kind, so it needs no sign-in. It is also sent in `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058). Opening the link shows a confirm button, so a mail scanner's visit changes nothing; a mail app's one-click POST takes effect at once.
  - **Exactly once:** each email is recorded in `app.email_delivery` before it goes, keyed by (business, person, kind, week or insight). A repeated run never sends twice. A failed send is marked failed, not retried: these are notices, not receipts.
  - **Content:**
    - Numbers come from the digest, which code formatted from an executed query (rule 5).
    - Insight text comes from uploaded data, so it is HTML-escaped.
    - Each email has a plain-text and an HTML part.
  - **Sending:** through Resend (free tier) via `sendEmail` in `@bizr/platform`, shared with sign-up, reset and invite emails. Without `RESEND_API_KEY` emails are only logged (ADR-026). Tests capture them with `setEmailTransport` and never touch the network.
- **Consequences:**
  - No new service and no cost. Resend Free allows 3,000 emails a month and 100 a day, which covers early customers.
  - A verified sending domain is needed before real customers. It is already on the production runbook.
  - A failed email is visible in `email_delivery`; `/admin` can show it later.

## ADR-058 — Linked sources: imports that update themselves

- **Status:** Accepted (2026-10-26). M10.
- **Context:** Owners keep their data in a Google Sheet or a shop platform and change it every day. Re-uploading by hand is the chore the product is meant to remove (PRODUCT_SPEC: connectors).
- **Decision:**
  - **A connection is a source of files.** Each check fetches the source as an ordinary workbook and runs it through the same import as an upload: analysis, mapping, merge preview, apply, undo. There is no second pipeline and no new way to write tenant data. `app.connection` holds the source; `ingestion_run.connection_id` marks the imports it caused.
  - **Unchanged means nothing happens.** A check compares a hash of the cells (not the bytes, which change with every export) with the last one.
  - **When it carries on by itself:** `ingest.analyze` and `ingest.apply` got a last `continue` step. A linked import goes on alone only when all of these hold:
    - it is not the source's first import (the owner sees that one through, both steps)
    - automatic updates are on and the source is active
    - every sheet with something to bring in is one we recognise (same headers and name, approved mapping reused)
    - every open question only adjusts a recognised sheet's own mapping (for example its date order); a question about grouping names still waits
    - the comparison has no conflict with a value the owner changed by hand

    Otherwise the import waits, exactly like an upload, and My data and Home say it needs a look.
  - **Checks:**
    - daily (`connections.daily`, before the day's insights) and on "Update now" (`connections.sync`)
    - at most one check a minute per source, and none while one of its imports is unfinished
    - a check runs as the person who linked the source, only while they are still a member
  - **Job steps can queue jobs** (`StepContext.enqueue`), so a check started in a drain or the worker hands on to the import jobs.
  - **Fetching is never open-ended:**
    - only from addresses our code builds from a parsed id
    - only https, only to allowed hosts (redirects included)
    - capped at 25 MB, with a time limit
    - tests replace the transport (`setConnectorFetch`)
  - **Google Sheets** are fetched by share link: "Anyone with the link can view" or published. That needs no account, key or cost. The whole workbook comes as Excel from `docs.google.com/spreadsheets/d/<id>/export?format=xlsx`, following redirects only to `*.googleusercontent.com`. A sign-in page or a 403 means the sheet isn't shared, and the message says how to fix it.
- **Consequences:**
  - Any future connector only has to produce a workbook.
  - Unlinking keeps the records and the history.
  - Private Google Sheets (signing in with Google) need Google's sign-in and a consent screen. That is on the roadmap.

## ADR-059 — Shopify through a Dev Dashboard app

- **Status:** Accepted (2026-10-26). M10.
- **Context:**
  - Since 1 January 2026, merchants can't create custom apps in the Shopify admin.
  - New apps live in Shopify's Dev Dashboard (free) and are installed through Shopify's sign-in.
  - Public apps created since 1 April 2026 must use expiring offline tokens: 60 minutes, with a refresh token that lasts 90 days and rotates on every use.
- **Decision:**
  - **Install:**
    - "Connect Shopify" takes the store's address. Only `<name>.myshopify.com` is accepted.
    - It sends the owner to `https://<shop>/admin/oauth/authorize`, read scopes only: products, inventory, orders, customers.
    - It sets a random state in an encrypted cookie that lasts 10 minutes and holds who asked and for which business.
  - **Callback** (`/api/connect/shopify/callback`):
    - checks Shopify's HMAC, the state, the shop, the signed-in person and their membership
    - swaps the code for an expiring offline token (`expiring=1`)
    - stores it AES-256-GCM encrypted under `CONNECTOR_SECRET`
    - queues the first check
  - **Tokens:** a token within 5 minutes of expiry is refreshed, and the new pair is stored before it is used.
  - **What is read:**
    - Admin GraphQL, version from `SHOPIFY_API_VERSION` (default `2026-07`), with throttling waited out
    - one workbook: Products (one row per variant, with cost and stock), Customers, and Orders (one row per item sold, UTC times)
    - orders changed since a day before the last check; the first time, the last 365 days, capped at 20,000 orders. The merge keeps orders it doesn't see again, so nothing is lost.
  - **Webhooks** (`/api/connect/shopify/webhooks`, HMAC-checked):
    - `app/uninstalled` and `shop/redact` disconnect the store and forget the token; the records stay
    - `customers/data_request` and `customers/redact` are recorded with Shopify's ids only and listed on `/admin` for the team to act on within 30 days
  - **Off by default:** without `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` and `CONNECTOR_SECRET`, the option is hidden and the routes answer 404.
- **Consequences:**
  - $0: a Dev Dashboard app and a development store are free.
  - **Built and tested against recorded answers only.** The queries follow Shopify's documented API, but they haven't been run against a real store, and shopify.dev isn't reachable from the build environment. A first live check on a development store is the owner's step (Q26).
  - Orders older than 60 days need Shopify's `read_all_orders` access, and customer names and emails need protected-customer-data access. Both are requested in the app's settings (`docs/RUNBOOK_SHOPIFY.md`).
  - Bulk exports, for very large stores, are on the roadmap.

## ADR-060 — Planning ahead: estimates, goals and the reorder list

- **Status:** Accepted (2026-10-26). M11.
- **Context:**
  - Owners ask "how will next month go?", "will I hit my target?" and "what should I order?".
  - The MVP spec left forecasting beyond run-rate maths for later; the roadmap lists season-aware forecasting and goals.
  - Rule 5 (never invent numbers) and rule 6 (show assumptions) still apply.
- **Decision:**
  - **Estimates are code, not AI.** `planning/forecast.ts` is pure and deterministic. Its input is a daily series from an executed query of a pack measure (`runQuery`, the same definitions as every answer). Today is left out: its sales aren't all in.
  - **Methods**, by how much history there is:
    - **13 months or more:** last year's same weeks, weekday-aligned and steadied over three weeks, scaled by the last 4 weeks against the same weeks a year earlier.
    - **12 months:** a month-of-year pattern from the year, the weekday pattern from the last 12 weeks, and today's level from the last 4 weeks.
    - **Less:** the last 4 weeks and their weekday pattern carried on, saying the season isn't known yet.
    - **Under two weeks:** no estimate.
  - **Range and wording:**
    - The range is the mean error of the same method on the last three 4-week periods, between 5% and 60%.
    - Estimates show rounded to three figures with "about", with their range and one sentence per assumption (season, growth, busiest weekday, no season yet).
    - Recorded numbers ("so far", the goal itself) stay exact.
  - **Back-test:** on the demo shop with two years of trading, the November estimate made on 1 November is within 15% of what was sold, and closer than the run-rate. March is within 15% too. `planning/backtest.test.ts` checks both on every run.
  - **Goals** (`app.goal`):
    - one standing monthly goal per pack planning measure (`pack.yaml` `planning.goals`)
    - each goal shows: this month so far (exact, from the query), where the month is heading (yesterday's total plus the estimate for the remaining days), a status (ahead or on track within 5% and 3%, behind, reached), and what each remaining day would need
    - shown on Home, on Plan ahead, and in the weekly email
  - **Reorder list:**
    - every product whose stock won't last the supplier's lead time plus 30 days (14 days when none is recorded), from the same measures as the "running out" alert
    - the quantity covers that window, scaled by the business's expected items sold over it against its last 4 weeks (between 0.5 and 3), the same factor for every product
    - grouped by supplier, downloadable as CSV or Excel
  - **Packs:** `pack.yaml` `planning: { goals, forecasts }` names the measures. The loader refuses snapshot or percent measures, which don't add up over days.
- **Consequences:**
  - $0, no AI calls.
  - Home runs about 0.2 s more per business with goals (two goals measured on the demo shop).
  - Not built yet: per-product seasons (a Christmas-only product gets the business-wide factor) and estimates in Ask ("how much will I sell next month?"). Both are on the roadmap.

## ADR-061 — Asking about what's ahead; each product's own season

- **Status:** Accepted (2026-10-27). M12.
- **Context:**
  - M11 gave owners estimates, goals and a reorder list on their own pages; owners also ask for them in Ask.
  - The reorder list used one business-wide season, so products that sell only around Christmas never appeared before Christmas.
- **Decision:**
  - **Rules first, AI untouched.** Ask checks `estimateRequestWithRules` before interpretation, and after change requests. The AI's interpretation schema and prompts don't change, so the AI can neither produce nor see an estimate.
  - **What the rules recognise:**
    - an estimate for a pack planning measure over a coming period: tomorrow, next week, next month, the next N days, weeks or months, the coming week or month, the rest of this month, this month or week, or a named month still ahead
    - goal questions ("on track", "hit my target")
    - "what should I reorder"
    - a coming period for a measure that can't be estimated, such as a margin or stock: a plain "I can estimate net sales, orders and items sold ahead"
  - **What they leave alone:** anything that also reads as the past ("did", "last", "ago", "so far") goes to the normal interpretation.
  - **Answers** are a new answer kind, `estimate`:
    - the headline: "About $X for November 2026, likely between $L and $H", plus what's already recorded when the period has started
    - week-by-week (or day-by-day) estimates as the table and chart; "How I calculated this" names the basis and the range; assumptions are the engine's notes plus "estimates, not promises"
    - goal progress and the reorder list reuse M11's wording
    - every number comes from the engine or an executed query
    - estimates can be downloaded but not pinned: a tile is a record, re-run with fresh data
  - **The eval runner applies the same rules first.** Questions can expect `estimate`, checked for kind, measure and dates, scored as `estimateAccuracy`. 26 cases were added. "What should I reorder this week?" now expects the reorder list.
  - **Each product's own season** (reorder list, 13 months of history or more): a product's need over its cover window is the larger of two figures:
    - its recent rate times the business's season factor
    - its units sold in the same weeks last year, times the business's last 4 weeks against the same weeks a year earlier (between 0.5 and 2)

    Last year's units come from one query per distinct cover length. A product that isn't selling now can be on the list, marked seasonal with last year's figure. A product selling now keeps the alert's own days of stock.
- **Consequences:**
  - **Acceptance met:**
    - all 27 forward-looking eval cases are recognised, and no historical question is taken for an estimate
    - on a two-year demo shop in mid-October, the Christmas products are on the list, with last year's figures within 10% of what the simulation sold
  - Phrasings the rules miss fall through to the normal interpretation, which answers about the past (R39). A future prompt version could teach the AI to hand them over; that needs the API key and an eval run (Q20).

## ADR-062 — Working as a team: a view-only role, notes, handing insights to people

- **Status:** Accepted (2026-10-27). M13.
- **Context:**
  - Small businesses have helpers who should see the numbers but not change them: a bookkeeper, an investor, a part-time assistant.
  - People who share a business want to say what they did about an alert ("ordered 50 more") and who is dealing with it.
  - Until now there were two roles: the owner, and members who can change everything except people and deleting the business.
- **Decision:**
  - **A third role, `viewer` ("Can view").**
    - Viewers can open every page, ask questions, download, leave notes, and choose their own email settings. They change nothing else.
    - The owner picks the role when inviting and can change it later. Roles are listed in Settings in plain words.
    - The owner's own role never changes here, and there is still exactly one owner.
  - **Enforced in two layers.**
    - Every core service that changes data starts with `requireEditor(member)`: imports, records, set-up, sources, dashboard, goals, alerts, renames and business details (32 services, each refused for a viewer in `roles.int.test.ts`).
    - Every server action starts with the web `requireEditor(slug)`, or is on a short list of actions viewers may use, each with its reason.
    - `role-guards.test.ts` reads every action file and every business route. A new action that is neither guarded nor listed fails CI.
    - Routes that change something (upload, Shopify connect) check `canChange`; the Shopify callback refuses a viewer too.
    - The UI hides what a viewer can't use (`CanChangeProvider`). This is a convenience; the server is the guard.
    - A linked source whose creator becomes a viewer stops updating, with a "please link it again" message, as when they leave.
  - **Notes** (`app.note`) on insights and on answers (Ask conversations are shared by the business):
    - plain text, control characters removed, 1 to 1,000 characters, at most 200 per item
    - shown with the author's name and time, rendered as text
    - only the author or the owner can delete one
    - the activity log records that a note was added or removed, not its words
    - notes are never given to the AI and never read as facts
  - **Handing an insight to a person** (`insight.assigned_to`, `assigned_by`, `assigned_at`):
    - owners and members hand open insights to an owner or member (not a viewer, who couldn't act on it)
    - the person sees it under "For you" on Home and in a "Handed to you" list in their weekly email
    - they (or anyone who can change things) mark it done, which clears it and leaves a "Marked done." note
- **Consequences:**
  - $0, no AI calls, no new accounts.
  - Two migrations: the viewer role (0018), notes and hand-offs (0021). 0019 and 0020 are the security fixes (ADR-063).
  - Not built (roadmap): permissions per area, transferring ownership, @mentions and email notifications for notes.

## ADR-063 — Linked imports carry on only with exactly the approved mappings; checks hold a lease

- **Status:** Accepted (2026-10-27). Security review of M9–M12; amends ADR-057, ADR-058 and ADR-059.
- **Context:** an independent review of the M9–M12 code found two medium and three low issues (no outside attack: all were consent or race problems).
- **Decision:**
  - **An automatic re-import is only what the owner approved** (`changedFromApproved`). It waits for the owner if:
    - the proposal would treat any records as one (the AI may propose that without asking a question)
    - any mapped sheet's mapping differs from the one saved when the owner approved it (the AI's check can revise one)
  - **A check holds the source** (`connection.syncing_until`, 30 minutes, cleared when done), so "Update now" and the daily job never read and import the same source twice at once.
  - **A check never undoes a pause or a disconnect** made while it was reading: its status updates apply only while the source is still `active` or `needs_attention`, and it re-reads the status before starting an import.
  - **A refreshed Shopify token is stored only over the pair it replaced.** If the store was connected again meanwhile, the newer tokens win.
  - **A failed email is tried again** on the next run, up to three times (`email_delivery.attempts`). One that was sent or is being sent never is.
- **Consequences:** each fix has a test that fails without it. Webhook replay protection (deduping on Shopify's webhook id) stays a nice-to-have: replaying needs a captured signed body.

## ADR-064 — A second industry pack: Wholesale & Distribution; the core reads industry choices from the pack

- **Status:** Accepted (2026-10-27). M14.
- **Context:**
  - The pack format promised that a new industry needs only pack files. The core still named retail's measures in a few places: Home's and the weekly summary's key numbers, how much history there is, the reorder list, goal words in Ask, and which measures Ask lists by product or customer.
  - Without the AI key (Q20), files are mapped by the rules-only proposer. It knew retail's table shapes and nothing else, so a customer list or a payments sheet was ignored.
- **Decision:**
  - **The pack says it.** New optional pack settings, every one checked by the loader against the pack's measures:
    - `key_numbers.home`, `key_numbers.weekly`, `key_numbers.activity`
    - `planning.goal_words`, `planning.reorder`
    - `helpful_files` for the import page
    - per measure, `list` (`by`, `totals`, `who`, `nonzero`)
  - Retail's values reproduce exactly what the code did: the retail evals are unchanged (questions 0.929, ingest 11/11).
  - **Shared ids.** Packs reuse the record and measure ids that mean the same thing (`customer`, `product`, `sale`, `net_sales`, `order_count`…). The core's shape recognisers (order lines, product lists, supplier orders) and Ask's rules therefore work for any commerce pack. Labels, words, extra details and new measures are the pack's own.
  - **Import without AI for any pack.**
    - A sheet no shape recognises is matched to the record whose fields its headers name best. It needs every required field, at least two fields and half the filled columns explained.
    - Links to other records match on their single-field keys (account number, email, name, invoice number). Master records (customers, suppliers) are created from the links; dated ones (invoices) are not.
    - After any shape, leftover columns that name a detail of a record the sheet already fills are kept, using the best-scoring field. They are skipped when two records would take them equally well.
  - **Numbers:** "30 days" and "Net 30" read as 30, for payment terms.
  - **The wholesale pack** (VERTICAL_PACKS Part 3):
    - trade-account details (account number, rep, price list, terms, credit limit), invoices with customer order numbers, backorders, credit notes
    - eight new measures and four new insights: over the credit limit, paying later than usual, a missed reorder, backorders building
    - a dashboard on the last 90 days, 16 example questions, and the same planning and reorder settings as retail
  - **A demo wholesaler** (Harbour & Pine Supply Co.) with an answer key, a `--pack` option on `demo:generate` and on the question eval, an ingest fixture, and its own baseline (`wholesale-rules`).
- **Consequences:**
  - **Acceptance met:**
    - the demo wholesaler's five files come in without AI, every column mapped
    - all nine planted stories are found, with the answer key's numbers; all 12 dashboard tiles work
    - the wholesale question eval is 98.3% with rules only (59 cases, demo subset 100%); the retail evals are unchanged
    - the new pack needed no code change beyond its folder: the build discovers packs
  - $0, no AI calls.
  - Not shared yet: an industry whose records differ (salons' appointments, restaurants' covers) needs new shape recognisers or the AI. The generic list recogniser covers simple lists only (R43).

## ADR-065 — PDF reports and scheduled report emails

- **Status:** Accepted (2026-10-27). M15.
- **Context:** owners pass numbers on to accountants, partners and banks, and want the dashboard in their inbox without opening the app. CSV and Excel downloads (ADR-056) don't print well.
- **Decision:**
  - **PDFs are laid out by code from the views the screens use** (`TableView`, `KpiView`, the answer's sentence, steps and assumptions). The writer (`export/pdf.ts`) formats nothing and recalculates nothing.
    - It uses PDFKit (MIT, free) with its built-in Helvetica: no font files or service.
    - It draws a bar or line chart from the plotting numbers when the answer has a chart; long tables run over pages with their headings repeated (at most 500 rows).
    - Characters Helvetica can't print are written the nearest plain way ("→" as "->"), never as nonsense (R44).
  - **Downloads:** `?format=pdf` for answers and tiles, and `/api/w/<slug>/dashboard/download` for the whole dashboard (every tile with its own dates). Same membership checks as the other downloads.
  - **Scheduled reports** (`app.report_schedule`):
    - the dashboard or a question, weekly (a weekday) or monthly (day 1–28)
    - only ever emailed to the person who set it up, while they are part of the business; viewers can set them up too
    - a question's meaning (its query spec) is re-run each time, so "last month" is the month before the day it's sent
    - set up after this period's day, the first one goes next period
    - the daily `reports.daily` job sends each due report once per period: the period ("2026-W44", "2026-11") goes into `email_delivery` under the new kind `report`, so retries (ADR-063) and exactly-once come for free
    - the PDF is attached; the email has a signed one-click stop link (List-Unsubscribe) that pauses the report; "Your reports" in Alert settings lists them, to pause or delete
    - demo businesses send nothing
  - PDFKit stays outside the Next.js bundle (`serverExternalPackages`), so it finds its font metrics.
- **Consequences:**
  - $0. Without `RESEND_API_KEY`, report emails are logged with their attachment's name and size.
  - A dashboard PDF of 12 tiles is about 30 KB; making one takes the same queries as the dashboard.
  - Not built: reports to other addresses (an accountant without an account), CSV attached instead of PDF, a logo.

## ADR-066 — Connect other apps: read-only API keys, a sessionless MCP server, signed webhooks

- **Status:** Accepted (2026-10-27). M16.
- **Context:** owners use other tools (spreadsheet scripts, accounting add-ons, AI assistants such as Claude) and want them to read the business's numbers without copying figures, and to hear when something new happens. Whatever comes in from outside must not weaken the safety rules: no free-form SQL, tenant isolation, no change without a person's approval, never invented numbers.
- **Decision:**
  - **Keys** (`app.api_key`):
    - per business; made and revoked by the owner only; shown once, stored as SHA-256
    - a key reads as a `viewer` member (M13), so every core service that changes something refuses it (ADR-062); there is no write call at all
    - one statement checks the key and counts the request: 60 per key per fixed minute (`window_start`, `window_count`), then 429 with Retry-After
    - not for demo businesses; created and revoked keys go in the audit log
  - **Public API** (`/api/v1`, `platform/api.ts`):
    - business, measures and details, a query, a plain-words question, insights, dashboard
    - the query is Ask's own typed form (`questionSpecSchema` with defaults: no breakdown, no filters, all time), resolved with the business's calendar and compiled by the semantic layer; unknown measures or details are refused (422)
    - runs as the business's reader with `query_run.origin = 'api'` (new origin)
    - results give raw values (money as exact strings) and the app's formatted text; `period.to` is the last day included
    - questions go through `askQuestion` with no person (`userId` null), so they appear in no one's Ask history and use the same AI budget caps
    - OpenAPI 3.1 at `/api/v1/openapi.json`, generated from the Zod inputs
    - no cookies are read on these routes and no CORS headers are sent: a key is the only way in
  - **MCP server** (`/api/mcp`, `platform/mcp.ts`):
    - Streamable HTTP without sessions: each POST is one JSON-RPC message (batches accepted) with a JSON answer; GET and DELETE are 405
    - written by hand (about 200 lines) rather than with the SDK's server, so it runs inside a Next route handler with no session state; the official SDK client checks it end to end in e2e
    - the six tools are the API's reads, annotated read-only; inputs are the same Zod schemas as JSON Schema
    - results start with a line saying the values are the business's records, data rather than instructions (safety rule 4 for the assistant on the other end)
    - an `Origin` header other than our own is refused (DNS rebinding)
  - **Webhooks** (`app.webhook`, `app.webhook_delivery`):
    - owner only, at most 5 per business; https only; events `insight.created` and `import.completed`, plus a `ping` test
    - the signing secret is shown once and stored sealed (AES-GCM under `CONNECTOR_SECRET`, ADR-059), so webhooks need it set
    - events go to an outbox, unique per webhook and event key (`insight:<id>`, `import:<run>`), so a step that runs twice queues nothing new
    - sent straight after the import or insight run (already background work); retried by `webhooks.deliver`, queued by the hourly check when something is due: 1 min, 10 min, 1 h, 6 h, 24 h; off after the 6th failure until the owner turns it back on
    - a minute's lease (`locked_until`, `FOR UPDATE SKIP LOCKED`) stops two runs sending the same delivery
    - signed like Stripe: `t=<unix>,v1=HMAC-SHA256("t.body")`; receivers refuse timestamps over 5 minutes old
    - **No private addresses (SSRF):** refused when saved (loopback, RFC 1918, link-local and metadata, CGNAT, multicast, IPv6 ULA/link-local, IPv4-mapped, `localhost`/`.local`/`.internal`/dotless names). At send time the connection's own `lookup` refuses any private address the name resolves to (so a name re-pointed later is still caught), numeric hosts are checked directly, redirects aren't followed, and there's a 10-second timeout and a 4 KB read cap. `WEBHOOKS_ALLOW_PRIVATE=on` lifts this for local development and e2e only; `pnpm preview:check` refuses it
  - **"Connect other apps"** (Settings → `/w/<slug>/settings/apps`): keys, how to connect an AI assistant, webhooks with "Send a test". Owner only; others see who to ask.
- **Consequences:**
  - $0: no new service. The MCP SDK is a dev dependency for the e2e client only.
  - Keys can't be scoped (all reads or none), and there is no OAuth for MCP clients that expect it: a client must let you set a header (R45).
  - The per-minute count is a database write per request, which is fine at our scale; a cache would come with paid hosting.
  - Not built: write access, per-key scopes, OAuth, webhook events for record edits, delivery history on the page.

## ADR-067 — S3-compatible storage driver with our own SigV4 signing, and a checked move

- **Status:** Accepted (2026-10-27). M17. Builds out ADR-013's third driver.
- **Context:** the free preview keeps uploads in Postgres (`app.storage_blob`); paid production (Stage 2) needs object storage. The owner asked for everything that needs no account to be built now. ADR-026 still holds: no bucket is created or paid for until there is revenue.
- **Decision:**
  - **`s3Storage`** in `packages/db/src/storage`, behind the same `Storage` interface. `exists()` is added to all three drivers.
    - Works with AWS S3 (virtual-hosted addresses), Cloudflare R2 and MinIO (path style, `S3_ENDPOINT`).
    - `put` writes only when the object isn't there (content-addressed, never modified).
    - `deleteWorkspace` lists `w/<id>/` page by page and deletes eight at a time.
    - No redirects followed; 60-second timeout.
  - **Signing written out** (`sigv4.ts`, about 60 lines over `fetch`) instead of the AWS SDK: no dependency, no bundle weight. It is checked against three of AWS's published S3 signature examples (GET with a range, PUT with extra headers, a query-string list), which can't match by luck.
  - **Settings** `S3_BUCKET`, `S3_REGION` (default `auto`), `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PATH_STYLE`. With `STORAGE_DRIVER=s3`, a missing bucket or key, or `auto` without an endpoint, stops start-up.
  - **`storage:move`** (`moveStoredFiles`): takes the files every `app.upload` row points to and copies each from the source driver to the target. The upload table is the record of what must exist.
    - Each file's bytes are checked against the fingerprint in its key, before writing and again after reading it back.
    - The source is never deleted. A re-run only checks, and `--dry-run` writes nothing.
    - It exits non-zero if any file is missing or damaged, so it can gate the switch.
  - Encryption at rest is the provider's default (R2 always; AWS SSE-S3 by default since 2023). We send no encryption headers that some S3-compatible stores reject.
- **Consequences:**
  - $0 now. Tests use an in-process S3 that re-checks every signature.
  - Not tested against a real bucket until Stage 2 (R48). The runbook's dry run is the first real check.
  - Not built: multipart upload (files are capped at 25 MB, well under S3's 5 GB single-PUT limit), presigned downloads (files go through our server, which checks membership).

## ADR-068 — More sources: one sign-in flow for QuickBooks, Xero and Square, and WooCommerce's own approval

- **Status:** Accepted (2026-10-28). M18. Extends ADR-058/059 (linked sources, Shopify).
- **Context:** owners keep their sales in accounting tools (QuickBooks, Xero), till systems (Square) and their own stores (WooCommerce). The owner asked for these to be built now and kept hidden until keys exist, tested without the real services.
- **Decision:**
  - **One OAuth flow** (`connections/oauth/`) for QuickBooks, Xero and Square:
    - each provider supplies its addresses, the code swap, the refresh and a reader
    - the shared code keeps the random state in a sealed, ten-minute cookie (per provider, path `/api/connect/<kind>`) naming the person and the business
    - on return it checks the state (constant time), the provider, the time, the signed-in person, and that they can still change things; a refusal on the provider's page says so
    - tokens are sealed (ADR-059); refreshing stores the new pair before using it, only over the pair refreshed (ADR-063); the first check is queued and its import reviewed like a file
    - routes: `/api/w/<slug>/connect/<kind>` and `/api/connect/<kind>/callback`
  - **Readers turn each service into one of two workbooks** (`connections/workbook.ts`), so the import recognises them without AI and later updates match:
    - shops (Square, WooCommerce, and now Shopify through the same builder): Products, Customers, Orders
    - accounting (QuickBooks, Xero): Invoices, Customers, Payments, Products, in the headers the wholesale demo uses
    - the Payments tab is left out for industries without payment records (retail), because it would otherwise be read as invoice totals (wrong for part payments)
    - an invoice is Paid or Unpaid; overdue comes from the due date, so the file changes only when the invoice does
    - money stays decimal strings; Square's smallest units become decimals by the currency's own places
  - **Per provider:**
    - **QuickBooks:** query endpoint, 1000 a page, `minorversion=75`. Basic-auth token calls; rotating refresh tokens. Payments for invoices older than the fetch have their invoice numbers looked up.
    - **Xero:** granular read scopes (apps since March 2026). The organisation just approved is the newest in `/connections`. `xero-tenant-id` on every call, calls one at a time, `If-Modified-Since` for updates; sales invoices that are AUTHORISED or PAID only.
    - **Square:** code flow (30-day access, a refresh token that doesn't expire). Catalog with categories, stock summed over locations, customers, and completed orders ten locations a search, sorted on the date the filter uses. `Square-Version` from settings.
    - **WooCommerce:** no app to register.
      - The owner types the store's address and approves read access on the store's own page. The store posts a read-only key to `/api/connect/woocommerce/keys` with the sealed token we gave it (store, business, person, ten minutes).
      - The key is kept only if it works on that very store.
      - The store's address is the one a person types, so it must be public https (no IPs on private networks, internal names, ports or passwords), and every request goes out through `safeFetch({ publicOnly })`: the connection's own lookup refuses private addresses (as webhooks, ADR-066).
      - Products with options are listed as their variations.
  - **Hidden until switched on:** each button shows only with its keys and `CONNECTOR_SECRET`; WooCommerce with `CONNECTOR_SECRET` and an https `APP_URL`.
  - **Tests** play every provider back from recorded answers in its documented shapes (`connectors.int.test.ts`): connect, import without AI, counts and money, token refresh and rotation, refusals (forged state, another person, another provider's cookie, the owner saying no, a Woo key that doesn't work, an expired token).
- **Consequences:**
  - $0 to build; free developer tiers to use (Xero's allows 5 organisations, R49).
  - Not met the real services yet (R50, Q30).
  - Left out for now: refunds, returns and credit notes; Woo costs (R51); disconnect webhooks from QuickBooks, Xero and Square (a revoked token shows as "needs attention" at the next check instead).

## ADR-069 — Handing a business over by offer and acceptance; @mentions read from the note's text

- **Status:** Accepted (2026-10-28). M19.
- **Context:** businesses change hands (a sale, a partner taking over, a founder stepping back), and people want to point a teammate at a note. Until now the owner was fixed for good, and a note couldn't name anyone.
- **Decision:**
  - **Handing over** (`team/ownership.ts`, `app.ownership_transfer`):
    - the owner picks someone already in the business (viewers too) and types its name, as for deleting it
    - nothing changes until the person accepts; one offer waits at a time (a partial unique index), a new one replaces it, and it lapses after seven days
    - the person sees it in Settings and on Home; it is also emailed to them, and the old owner hears the outcome (kind `ownership` in the email ledger; confirmed addresses only)
    - on acceptance, in one transaction with the offer row locked: the offer must still be waiting and for this person, the old owner must still be the owner, the person must still be in the business. The old owner becomes a member first, then the person the owner.
    - **one owner per business is now a database rule** (partial unique index on `workspace_member` where role is owner). The migration first demotes any extra owners, keeping the earliest; a test-script artefact in the dev database had two.
    - demo businesses can't be handed over; everything belongs to the business, so keys, webhooks, sources and reports keep working
  - **@mentions** (`app.note_mention`):
    - the note's own text decides who is named: "@" plus a person's full name in the business, not followed by more letters, longest names first, never the author. No hidden ids travel with the note, and what you see is what was sent.
    - the notes box offers names after "@"; saved notes show mentions highlighted
    - a mention appears under "For you" on the person's Home until they choose "Got it"
    - it is emailed once per note (the note id is the ledger key), quoting the note as written (plain text, escaped in HTML), with its own one-click stop link and a "When someone mentions you" switch in Alert settings
    - viewers can mention and be mentioned, as they can leave notes
- **Consequences:**
  - $0.
  - Two people with exactly the same name are both mentioned by "@Name" (R52).
  - Not built: mentions in the weekly summary, mentioning people outside the business, handing over to someone by email who isn't in the business yet (invite them first).
- **Found on the way:** the SQL validator's CTE scan was recursive and ran before its depth limit, so a very long expression could overflow the stack instead of being refused. It now walks with its own stack, and a stack overflow anywhere in validation counts as a refusal (tested with a 100,000-level tree).

