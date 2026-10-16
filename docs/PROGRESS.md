# Progress Log

## Current Status

- **Milestone:** M4 (Ask) is **complete on the rules path**; its one open check is the live-AI eval
  run, which needs the API key (Q20). M5 (Dashboards) is next, once the owner confirms. The owner
  authorised building through the milestones (ADR-031).
- **Branch:** `claude/elegant-hopper-dtc9gi`.
- **What runs today:**
  - accounts, onboarding, workspaces and settings (M1)
  - import from upload to data report (M2)
  - 28 retail measures, the query compiler and "What we track" (M3)
  - **Ask**: plain-language questions → rules-first interpretation (AI for the rest), answers with
    bold facts, charts with a table view, assumptions, "How I calculated this" with the SQL,
    clarifying questions, follow-ups, 👍/👎 with reasons, and "Add to dashboard" (pinned tiles show
    live on the Dashboard page)
  - **SQL fallback** behind a 160+ case adversarial validator, read-only as the tenant reader
  - `pnpm eval`: 11 ingest cases and **185 question cases** (rules only, $0)
- **M4 acceptance (rules only, no AI):** 91.9% of questions correct (≥ 85% needed), 100% on the demo
  script (≥ 95%), clarify precision 100% (≥ 80%), validator suite 100%, no number in any sentence that
  doesn't come from a fact (by construction and tested), interpretation + query p95 under 0.1 s. With
  the AI on, latency and accuracy are still to be measured (R22, Q20).
- **Waiting on the owner (batched for the end):**
  - the Google OAuth client (`docs/RUNBOOK_GOOGLE_OAUTH.md`)
  - the Anthropic API key (Q20), for the first AI eval runs
- **Spend to date:** $0 infrastructure, $0 AI.

---

## Session log

### 2026-10-16 — Session 7: M4 Ask built

**Completed:**

- **SQL validator** (`@bizr/core/sql-validator`): libpg-query parse, default-deny allowlists, tenant
  relations only, internal columns hidden, rewrite through filtered shadow CTEs; 160+ attack cases;
  `runFallbackSql` read-only with a timeout and row cap.
- **Interpretation** (`@bizr/core/ask`, ADR-040):
  - time presets resolved by code in the workspace calendar
  - the typed interpretation (query / clarify / sql / unanswerable)
  - the rules interpreter (pack words, the owner's own values, time phrases, follow-ups, "best
    customers" → clarify)
  - Task D `interpret_question@v1` with code checks, one repair and one strong-tier try
  - best guesses only when most of the question was understood
- **Answers** (ADR-041):
  - facts with exact money, code's own sentence, Task E `narrate_answer@v1` with placeholder checks
  - Task F `explain_sql@v1`, "How I calculated this" from the spec, and the chart chooser
  - pack nouns and display names (`online_store` → "Website") and pack example questions
    (`questions.yaml`)
- **Storage:** migration `0007_ask_and_tiles`: `conversation`, `answer`, `dashboard`, `dashboard_tile`.
- **Web:**
  - Ask screen: chips, thinking state, answer / clarify / can't-answer cards, Recharts charts with a
    table toggle, feedback, pin with Undo, conversation kept in the URL
  - Dashboard shows pinned tiles live
- **Evals:**
  - `evals/questions/retail.yaml`: 185 cases scored by result on the seeded demo data
  - `pnpm eval -- --suite questions [--ai]` with a cost guard
  - a rules-only CI test and a baseline (`evals/baselines/questions.json`)
- **Tests:** 590 unit/integration (up from 294) and 16 e2e, which now cover asking, clarifying,
  feedback, pinning, reload and the dashboard.

**Bugs found and fixed:**

- Comparisons with a breakdown crashed: Postgres can't FULL JOIN on `IS NOT DISTINCT FROM`. Both
  periods now join onto the union of their keys. A golden test and a ground-truth test were added.
- Supplier spend had two link paths (pack `join_paths` entry added).
- Fresh tenant tables had no planner statistics, so a customer ranking took 33 s. Tables are now
  `ANALYZE`d after every load.
- The value list kept only the 200 most frequent names, so small stockists weren't recognised. It
  now keeps up to 1000.
- Rule misreadings found by the evals: verbs read as measures, "who are my best customers" taken as
  a follow-up, nouns next to values, "since September", expense types, snapshot measures by day.
- `revalidatePath` in the pin action refreshed and reset the Ask screen.
- The pack loader test didn't expect `questions` (it was red on 442b139; fixed in d0cf2f4).

**Blockers:** none for building. The AI paths still need the API key for a live run (Q20).

**Next steps:**

1. When the key arrives: `pnpm eval -- --suite questions --ai --limit 40`, then the full AI suite and
   the ingest AI eval. Record the baselines and measure Ask p95 latency with AI on (R22).
2. On the owner's go-ahead, M5: the pack's default dashboard, date range picker, tile editing and
   versions on top of `dashboard` / `dashboard_tile`.

### 2026-10-16 — Session 6: M3 Semantic layer built

**Completed:**

- **Metric IR** (`@bizr/packs`):
  - windows, `latest`, per-record roll-ups with conditions, days-between and shifted period bounds
  - order-discount allocation, named expressions and filters
  - cross-checks and cycle detection
- **Retail `metrics.yaml`:** all 28 metrics from VERTICAL_PACKS §2.5, 11 breakdowns, and assumptions
  stated per metric (ADR-037).
- **Semantic core** (`@bizr/core/semantic`):
  - link graph with ambiguity detection
  - availability that drops optional parts
  - the query compiler: one CTE per aggregate (no double counting), roll-ups, period variants,
    comparisons, time buckets in the workspace time zone with week start and fiscal year, plain
    errors (ADR-038)
  - `fieldsWithData`, `refreshSemanticCatalog` (after every import), `loadSemanticModel`, `runQuery`
  - the glossary and renames
- **Database:**
  - migration `0005_semantic_catalog`: `app.metric`, `field.has_data`, `entity.record_count`
  - `v_<table>_enriched` views rebuilt with every structural change (ADR-039)
- **Web:** the "What we track" page (measures, "Unlock more", records, links, renames) in the sidebar
  and under More.
- **Tests:**
  - 294 unit/integration tests (up from 265) and 16 e2e
  - ground truth: every metric on the demo data matches the simulation across a month, channel /
    category / monthly breakdowns, a comparison, stock, customers and money owed; unavailable reasons
    are checked
  - golden SQL snapshots

**Bugs found by the ground-truth tests and fixed:**

- Unused parameters made Postgres fail.
- A channel with refunds but no sales showed blank instead of a negative number.
- "Previous period" for a calendar month used the 30 days before it.
- Overdue money owed missed invoices with a blank due date. They now count as due 30 days after the
  sale, and this is stated as an assumption.

**Notes / deviations:** no `app.relationship` table (links are fields); `requires` derived from the
IR (ADR-037).

**Next steps (M4 — Ask):**

1. `interpretQuestion` (Task D) producing a query spec, with clarifying questions and stated
   assumptions; replay-tested.
2. Deterministic chart choice and placeholder narration (Task E), with numbers filled by code.
3. SQL fallback through the `libpg-query` allowlist validator.
4. The Ask screen and "How I calculated this".
5. The first live AI eval run as soon as the key arrives (Q20).

### 2026-10-15 — Session 5: M2 Ingestion and AI data modelling built

**Completed:**

- **Demo data:** `packages/demo-data` generates the messy Fernwood files plus an answer key
  (ADR-036).
- **Parsing:** ExcelJS + Papa Parse + encoding detection (ADR-032).
- **Profiling:** region detection, column profiles and PII masking.
- **Cleaning-rule engine:** test-first.
- **Retail pack:** synonyms, patterns and a primer.
- **Change-plan compiler and applier:** with the catalog.
- **Data-model proposal:**
  - rule-based proposer first, AI Tasks A/B/C behind it (ADR-033)
  - versioned prompts with all file content inside `<workspace_data>`
  - validator and copy checks (no jargon, no invented numbers)
  - owner corrections applied by code and locked against AI changes
  - dry-run refinement
- **Ingestion backend:**
  - storage (local, Postgres)
  - migration `0004_ingestion`
  - jobs `ingest.analyze` / `ingest.revise` / `ingest.apply`
  - loader as the tenant writer (ADR-034, ADR-035)
  - review builder
  - data quality report
- **UI:** upload, processing, review (summary, questions, record cards with "This is actually…",
  skipped lines, assumptions with undo, "Anything look wrong?"), setting up, report. Also the My
  data import list and the Home call to action.
- **Evals:** `pnpm eval` with 11 messy cases including injection canaries; the rules-only suite runs in
  CI against a baseline.
- **Bugs found by the evals and fixed:**
  - a date with equal day and month (03/03/2026) counted as day-first evidence
  - "Receipt" headers weren't recognised as order numbers
- **Tests:**
  - 260+ unit/integration tests, including the full import through the real job system and an
    idempotent re-apply
  - 16 e2e tests (desktop + phone), including upload → review → answer → set up → report
  - cleaning and compiler line coverage 96%

**Notes / deviations (see ADR-032…036):**

- No SheetJS (its CDN was unreachable).
- Rules before AI.
- INSERT instead of COPY.
- S3 deferred.
- Queue renamed to `ingest.analyze`.
- The AI paths are tested with fake providers only (risk R17).

**Next steps (M3):**

1. Semantic layer from the pack: metrics IR, availability and plain-language definitions.
2. Generated views (e.g. enriched sale lines).
3. Records browser on My data.
4. When the API key arrives: record replays, run `pnpm eval -- --ai`, and compare Sonnet with Opus
   (Q20).

### 2026-10-15 — Session 4: M1 Accounts and workspaces built

**Completed:**

- **Owner instructions:** confirmed M0; "build everything for now"; Google OAuth client to be created
  at the end (ADR-031).
- **Control plane:** migration `0001_accounts_workspaces` adds:
  - Better Auth tables (UUID ids)
  - `workspace`, `workspace_member`, `workspace_settings`
  - `audit_event`, `query_run`
  - an FK from `job_run` to `workspace`
- **Tenancy (`@bizr/core/tenancy`):** idempotent provisioning/deprovisioning of `t_<id>`, `t_<id>_snap`
  and the reader/writer roles; `sql/ident.ts` identifier helper.
- **Safe executor (`@bizr/core/executor`):** settings set first, then `SET LOCAL ROLE`; READ ONLY cursor
  with a row cap; timeouts; `query_run` logging; user-safe errors.
- **Security finding fixed:** the new isolation suite showed a tenant role could
  `set_config('role', …)` into another tenant's role. `set_config` is now revoked from PUBLIC
  (ADR-005 amendment). Open risk R16: verify this works on Neon before hosting.
- **Workspaces (`@bizr/core/workspaces`):** create (with provisioning), list, membership-checked lookup,
  update details, owner-only delete.
- **Packs:**
  - entities schema with cross-checks
  - full retail catalog (13 entities, 86 fields)
  - packs compiled into a generated module (ADR-030)
- **Web:**
  - Better Auth (email/password; Google behind env vars; console/Resend email; rate limit
    switchable for e2e only)
  - auth pages: sign-up, sign-in, forgot/reset password
  - onboarding with locale guesses
  - app shell (sidebar / bottom tabs) with placeholder pages
  - settings with typed-name delete
  - `proxy.ts` signed-out redirect
  - `safeNextPath` open-redirect guard
- **Tests:**
  - 74 unit/integration tests (17 isolation cases, workspace service, packs, redirects)
  - 14 e2e tests across desktop + mobile
- **Docs:**
  - PLAN M1 ticked
  - ADR-005 amendment, ADR-030, ADR-031
  - `docs/RUNBOOK_GOOGLE_OAUTH.md`
  - ARCHITECTURE executor section
  - CLAUDE.md conventions (executor-only tenant access, `requireWorkspace`)

**Notes:**

- Screens were checked visually on desktop and phone sizes.
- Fixed a time-zone select bug where "UTC" was missing from Intl's list.

**Next steps (M2):**

1. Demo dataset generator (Fernwood Home & Gift) with ground truth.
2. Storage drivers (local / postgres / s3) and the upload route.
3. Parsing, region detection and profiling.
4. Cleaning-rule engine (test-first).
5. Change-plan compiler for create operations (test-first).
6. AI provider layer with replay and spend guard; Tasks A/B/C.
7. Loader, quality report, ingestion jobs.
8. Review screens.
9. Ingest eval harness.


### 2026-10-13 — Session 3: M0 Foundation built

**Completed:**

- Owner confirmed the AI budget caps (Q18) and asked to start building. M0 implemented:
  - **pnpm monorepo:**
    - `apps/web`, `apps/worker`
    - `packages/platform` (new: env + logging), `packages/db`, `packages/core`, `packages/ingest`,
      `packages/ai`, `packages/packs`
    - `evals/`, `scripts/`
  - **Tooling:**
    - TypeScript 6.0 strict (ADR-028: TS 7 isn't supported by typescript-eslint yet)
    - ESLint 10, type-aware, with package-boundary rules
    - Prettier
    - Vitest 5
    - Playwright
  - **Database:**
    - `pnpm db:setup` creates the four login roles idempotently, with least privilege
    - Drizzle control-plane migrations: `app` schema + `app.job_run`
    - Docker Compose Postgres 17 with a test database
  - **Job framework (ADR-011/029):**
    - checkpointed steps; worker mode and inline drain mode
    - transactional enqueue (pg-boss Drizzle adapter)
    - `system.noop` job
    - authenticated `/api/jobs/drain` route
  - **Web:** Next.js 16 + Tailwind 4 + shadcn tokens/Button, landing page, `/api/health`.
  - **Worker:** graceful shutdown, plus an `enqueue:noop` dev helper.
  - **CI workflow:** format, lint, typecheck, packs, unit + integration tests on Postgres 17, then the
    e2e smoke job. Runs on every push.
- **Verified locally** (this container used Postgres 16, since the Docker daemon isn't available here;
  `docker compose config` validated):
  - `pnpm lint`, `pnpm typecheck` and `pnpm format:check` are clean
  - `pnpm test`: 19 tests pass, including both job modes and role privilege checks
  - `pnpm build` succeeds
  - `pnpm test:e2e`: 6 tests pass (desktop + mobile)
  - Manual checks:
    - the worker processed a queued job and shut down on SIGTERM
    - the HTTP drain processed a job; an unauthenticated drain returns 401

**Notes / deviations:**

- Roles are created by `pnpm db:setup` rather than a Docker init script, so CI and local dev share
  one path and passwords come from `.env`.
- Import-order linting was deferred.
- CI triggers on every push (not on `pull_request`) to avoid duplicate runs.

**Next steps:**

1. ~~Confirm the first CI run is green~~: done (run #1 passed both jobs in ~2.5 minutes).
2. Owner confirms M0, then M1:
   - Better Auth (email/password + Google)
   - workspace tables
   - onboarding screen
   - tenant provisioning with per-tenant roles
   - safe executor skeleton
   - isolation test suite
   - app shell
   - pack loader for entities


### 2026-10-13 — Planning session 2

**Completed:**

- The owner approved the plan and accepted all proposed defaults (Q1–Q17 resolved).
- New owner rule: **zero infrastructure spend until production and revenue.** Docs updated:
  - **ADR-026 (new):** zero-cost operating rule.
  - **ADR-027 (new):** AI spend controls.
    - hard daily/monthly budget guard
    - replay-only tests and CI
    - on-demand evals with cost estimates
    - cheapest model tier that passes evals
  - **ADR-016 rewritten:** staged hosting. Local ($0) → optional free hosted preview ($0) → paid
    production after revenue.
  - **ADR-011 amended:** jobs are checkpointed steps that run either in a worker or via a serverless drain
    route (`JOB_RUNNER=worker|inline`), so no paid worker host is needed.
  - **ADR-013 amended:** added a Postgres storage driver for the free preview.
  - **ARCHITECTURE:** §11 (runner modes) and §13 (deployment stages) updated.
  - **PLAN:** M0/M1/M2/M8 tasks updated, and a "Production upgrade" item added to the roadmap.
  - **CLAUDE.md:** zero-cost rule added.
  - **DEMO_SCRIPT:** the demo runs locally.
  - **OPEN_QUESTIONS:** new Q18 (AI budget) and Q19 (free hosted preview platform/terms).

**Exact next steps:**

1. M0:
   - scaffold the pnpm monorepo, TypeScript, ESLint, Prettier
   - Next.js + Tailwind + shadcn, and the worker
   - job framework with both runner modes
   - Docker Compose Postgres with role init
   - Drizzle
   - Vitest/Playwright
   - GitHub Actions CI
   - `.env.example`
   - README
2. Before M2: confirm the AI budget (Q18).


### 2026-10-13 — Planning session 1

**Completed:**

- Reviewed the project brief. Raised clarifying questions and concerns with the owner.
- Owner decision: the target user changed from Shopify merchants to **any retail/ecommerce seller with
  messy data** (ADR-001).
- Created the planning documentation set:
  - `CLAUDE.md`
  - `docs/PLAN.md`
  - `docs/PROGRESS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/DECISIONS.md` (ADR-001…025)
  - `docs/PRODUCT_SPEC.md`
  - `docs/AI_DESIGN.md`
  - `docs/VERTICAL_PACKS.md` (format spec + full `retail` pack)
  - `docs/DEMO_SCRIPT.md`
  - `docs/OPEN_QUESTIONS.md`
- Checked current Anthropic model IDs and SDK structured-output usage. Defaults:
  - `claude-opus-5-5` (strong)
  - `claude-sonnet-5-5` (standard)
  - `claude-haiku-5-5` (fast)

  Current Opus/Sonnet models reject forced `tool_choice`, so we use structured outputs
  (`messages.parse` + `zodOutputFormat`) instead.

**Key design choices made in this session** (Proposed where the owner hasn't confirmed):

- Spec-first question answering with validated SQL fallback (ADR-007).
- Placeholder-based narration so numbers are correct by construction (ADR-009).
- Per-tenant reader/writer roles with `SET LOCAL ROLE` (ADR-005).
- A demo-critical path through the milestones, with cuttable items marked.
- The demo dataset generator starts in M2, so it doubles as the main ingestion fixture.

**In progress:** none.

**Blockers:** owner approval; P0 open questions (defaults proposed).

**Exact next steps (after approval):**

1. Apply any owner changes to the docs.
2. M0:
   - scaffold the pnpm monorepo, TypeScript, ESLint, Prettier, Next.js + Tailwind + shadcn, worker
   - Docker Compose Postgres with role init
   - Drizzle setup
   - Vitest/Playwright
   - GitHub Actions CI
   - `.env.example`
   - README
3. Open a PR for M0 when CI is green (only if the owner wants PRs opened).
