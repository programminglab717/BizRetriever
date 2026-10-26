# Runbook: moving to paid production (Stage 2)

**Status:** written in M8. **Not executed.** Under the zero-cost rule (ADR-026), nothing here is bought or
switched on until the product is in production, generating revenue, and the owner has said yes to each
cost.

The stages are set out in ADR-016. The app moves between them by configuration only: the same code runs
locally (Stage 0), on a free preview (Stage 1) and in paid production (Stage 2).

---

## 0. Before starting

- [ ] Owner approval, with a monthly cost estimate for each item below. Re-check vendor prices and terms
  on the day; they change often.
- [ ] `main` is green: lint, typecheck, unit and integration tests, e2e, `pnpm eval` (rules only).
- [ ] A security review of the branch being released (tenant isolation, the SQL validator, auth, uploads).
- [ ] Decide the production domain (for example `app.<brand>.com`) and the sending email domain.
- [ ] **Isolation on a managed database (ADR-054).** If the production Postgres host gives no true
  superuser (Neon and most hosts don't), build per-tenant login roles first (ADR-005 option 3).
  Without them, one database-level safety layer is missing, and real customers' data shouldn't depend
  on the SQL validator alone. `pnpm preview:check` reports which case a database is in.
- [ ] `pnpm audit --prod --audit-level high` is clean (CI runs it on every push).

## 1. Database (Neon paid, or equivalent Postgres 17)

1. Create the project and the database `bizretriever` on a paid plan with point-in-time restore.
2. Create the roles: run `pnpm db:setup` once with `DATABASE_URL_SUPERUSER` pointing at the owner
   connection. It creates `bizr_owner`, `bizr_app`, `bizr_admin` and `bizr_tenant` and the `pgboss`
   schema. Set strong generated passwords; store them only in the hosts' secret settings.
3. Use the **pooled** connection string for `DATABASE_URL_APP` and `DATABASE_URL_TENANT` (transaction
   mode is fine: we only ever use `SET LOCAL`, ADR-016). Use the direct connection for
   `DATABASE_URL_MIGRATE` and `DATABASE_URL_ADMIN` (DDL and long transactions).
4. Migrations run as a release step (`pnpm db:migrate`) before the new web version takes traffic. They
   are forward-only and additive by design; every structural change to tenant data has its own rollback
   (ADR-044).
5. **Restore drill:** restore yesterday's backup into a scratch branch, run `pnpm test` against it with
   `REQUIRE_DB_TESTS=1`, and delete the branch. Repeat quarterly.

## 2. Web app (Vercel Pro, or equivalent Node host)

1. Import the repo; root `apps/web`; build `pnpm build`; Node 24.
2. Set every variable from `.env.example` in the host's secret settings (never in the repo):
   - `NODE_ENV=production`, `APP_URL=https://<domain>`
   - `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `JOB_DRAIN_SECRET` (only if inline jobs stay on)
   - the four database URLs from step 1
   - `ANTHROPIC_API_KEY`, `AI_MODEL_*`, `AI_REPLAY_MODE=off`, and the budget caps agreed with the owner
     (`AI_BUDGET_DAILY_USD`, `AI_BUDGET_MONTHLY_USD`)
   - `STORAGE_DRIVER=s3` and its settings (step 4)
   - `RESEND_API_KEY`, `EMAIL_FROM` (step 6), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
     (`docs/RUNBOOK_GOOGLE_OAUTH.md`)
   - `ADMIN_EMAILS` (the founders only)
3. `JOB_RUNNER=worker` once the worker (step 3) is running. Until then, keep `inline` and the daily
   cron.

## 3. Worker (Railway, Fly.io or Render; one small always-on instance)

1. Service from the same repo: install with `pnpm install --frozen-lockfile`, start with
   `pnpm start:worker`, `JOB_RUNNER=worker`, the same variables as the web app.
2. It subscribes to every job queue, runs pg-boss maintenance, and queues the daily jobs
   (`insights.daily`, `snapshot.gc`) itself every hour (ADR-048). The drain cron is then no longer
   needed: remove it.
3. One instance is enough at launch. Jobs are idempotent and checkpointed, so a restart mid-job resumes.

## 4. File storage (Cloudflare R2 or S3)

1. **Build first:** the `s3` storage driver is not written yet (`packages/db/src/storage`; it throws
   today). It needs `put`, `get` and `delete` with server-side encryption, plus tests against a local S3
   emulator (MinIO, free).
2. Create a private bucket; credentials limited to that bucket.
3. Move existing uploads: a one-off script that copies every `app.storage_blob` row (Stage 1) or local
   file (Stage 0) to the bucket under the same key, then switch `STORAGE_DRIVER`.

## 5. Errors and monitoring (Sentry)

1. Add the Sentry SDK to web and worker behind `SENTRY_DSN` (not built yet; logs only until then,
   OPEN_QUESTIONS Q15). Scrub request bodies: uploads and cell values must never leave our systems
   except as masked samples to the AI provider (ADR-020).
2. Uptime check on `/api/health` every minute, alerting the founders.
3. Weekly: open `/admin` for AI spend per business, failed AI checks, query and job failures.

## 6. Domain and email

1. Point the domain at the web host; HTTPS on.
2. Verify the sending domain in Resend (SPF, DKIM, DMARC). Test the sign-up verification, password
   reset and invite emails.
3. Google sign-in: follow `docs/RUNBOOK_GOOGLE_OAUTH.md` with the production redirect URL.

## 7. Go-live checks

- [ ] Sign up, onboarding, "Try the demo shop", a real import, Ask, dashboard, insights, invite a
  member, re-upload, undo, delete the business. All on a phone too.
- [ ] `pnpm perf <slug>` against production: Home LCP ≤ 2 s, Ask p95 ≤ 6 s (PLAN M8).
- [ ] `/admin` shows AI calls as live (not replayed) and within the caps.
- [ ] A test business is deleted and its tenant schema and roles are gone.

## 8. Rolling back

- **Web:** promote the previous deployment in the host's dashboard. Migrations are additive, so the
  previous version runs on the newer database.
- **Worker:** redeploy the previous image; queued jobs resume from their checkpoints.
- **Database:** point-in-time restore to just before the release, only if data was damaged. This loses
  writes since then: tell affected owners.
