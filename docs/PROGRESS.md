# Progress Log

## Current Status

- **Milestone:** M1 (accounts and workspaces) is **complete**; M2 (ingestion and AI data modeling) is
  next. The owner authorised building through the milestones (ADR-031).
- **Branch:** `claude/elegant-hopper-dtc9gi`.
- **What runs today:**
  - sign-up / sign-in / password reset (email); Google is built but switched off
  - onboarding that creates a business with its own isolated data area
  - the app shell (desktop sidebar, mobile tabs) with placeholder pages
  - settings (edit details, delete business)
  - the safe tenant query executor
  - the job system
- **Waiting on the owner (batched for the end):**
  - the Google OAuth client (`docs/RUNBOOK_GOOGLE_OAUTH.md`)
  - the Anthropic API key (needed for live AI from M2; tests never need it)
- **Spend to date:** $0 infrastructure, $0 AI.

---

## Session log

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
