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

- **Status:** Proposed
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

- **Status:** Accepted (model defaults Proposed)
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

## ADR-011 — Background jobs with pg-boss in a separate worker process

- **Status:** Proposed
- **Context:** Ingestion, loading and insight runs take seconds to minutes. Vercel functions are
  time-limited and can't host a long-running consumer.
- **Options considered:**
  1. **pg-boss + a worker on Railway/Fly/Render.** Postgres-only, boring, no new vendor for the queue
     itself.
  2. **Inngest / Trigger.dev.** Hosted, no worker server, but adds a vendor and changes the execution model.
  3. **BullMQ + Redis.** Adds Redis.
- **Decision:** Option 1.
- **Consequences:**
  - One more deployable (the worker), using the same codebase.
  - Local dev runs two processes.

## ADR-012 — Auth with Better Auth

- **Status:** Proposed
- **Options considered:**
  1. **Better Auth.** Self-hosted in our Postgres, email/password + Google, an organization plugin for
     workspaces/invites.
  2. **Auth.js.** Mature, but history of breaking changes; organisations are DIY.
  3. **Clerk.** Fastest, but a paid vendor and user data lives outside our database.
  4. **Supabase Auth.** Implies the Supabase platform.
- **Decision:** Better Auth. Workspace membership is modelled in our own `workspace_member` table so we
  aren't locked to a plugin's model.
- **Consequences:** We own email sending for verification and reset (Resend proposed; console logging in
  dev).

## ADR-013 — Object storage abstraction

- **Status:** Proposed
- **Decision:**
  - A `Storage` interface with a local filesystem driver (dev/test) and an S3-compatible driver (prod:
    Cloudflare R2).
  - Original uploads are immutable and content-addressed (sha256).
- **Consequences:** Re-ingestion and audits are always possible. Storage retention policy is to be decided
  (OPEN_QUESTIONS).

## ADR-014 — File parsing: SheetJS + Papa Parse + encoding detection

- **Status:** Proposed
- **Decision:**
  - **SheetJS** (installed from the official SheetJS CDN tarball, since the npm registry copy is outdated)
    for xlsx/xls/ods. It handles merged cells, Excel date serials, and number formats.
  - **Papa Parse** for CSV/TSV (streaming, delimiter sniffing).
  - **jschardet + iconv-lite** to detect and decode legacy encodings (Windows-1252, UTF-16 with BOM).
- **Consequences:**
  - Formulas use cached values only. We never evaluate formulas.
  - Very large files (> limits, ADR-024) are rejected with a friendly message.

## ADR-015 — Charts: Recharts with a fixed chart set and deterministic chart choice

- **Status:** Proposed
- **Decision:**
  - Recharts via shadcn/ui chart components.
  - The chart set is fixed: `kpi`, `line`, `bar`, `bar_horizontal`, `stacked_bar`, `table`.
  - The chart type is chosen deterministically from result shape (rules in AI_DESIGN). The AI can only
    express a preference ("as a line chart") within valid options.
- **Consequences:**
  - Predictable, accessible charts.
  - No pie charts, except perhaps a later `donut` for ≤5-part shares.

## ADR-016 — Hosting: Vercel + Neon + Railway worker + Cloudflare R2

- **Status:** Proposed
- **Context:** Simple, managed, cheap at low scale, and good developer experience.
- **Decision:**
  - Web on Vercel.
  - Postgres on Neon (pooled URL for web, direct URL for worker/admin).
  - Worker on Railway.
  - Files on R2.
  - Local dev via Docker Compose.
- **Consequences:**
  - Three vendors.
  - Neon's pooler is in transaction mode, which is compatible with our `SET LOCAL` pattern. Never use
    session-level `SET`.

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

- **Status:** Proposed
- **Decision:**
  - Values detected as emails, phone numbers, or card-like numbers are masked in samples sent to the AI,
    preserving shape (`j***@g***.com`, `+1 ***-***-4821`).
  - Person names are not masked by default, because they're needed for dedupe reasoning.
  - Workspace setting `pii_masking` defaults to on.
- **Consequences:** Slightly less AI context for column classification. Detected column type (email/phone)
  is still passed.

## ADR-021 — Demo replay mode for AI calls

- **Status:** Proposed
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

- **Status:** Proposed
- **Decision:**
  - 25 MB per file.
  - 200k rows per sheet.
  - 20 sheets per workbook.
  - About 2M rows per workspace in total.
- **Consequences:** Covers the vast majority of SMBs. Limits are enforced with friendly messages and are
  configurable via env.

## ADR-025 — Locale handling: workspace currency, timezone and date order

- **Status:** Proposed
- **Decision:**
  - Onboarding captures currency (default USD), timezone (browser-detected), and date order (`DMY`/`MDY`,
    guessed from the browser locale).
  - The profiler uses date order to resolve ambiguous dates like `03/04/2026`. When the data itself
    contradicts the setting (e.g. `25/03/2026` under MDY), the profiler resolves it per column and records
    an assumption.
- **Consequences:** Fewer silent date errors, which are the most common real-world data bug.
