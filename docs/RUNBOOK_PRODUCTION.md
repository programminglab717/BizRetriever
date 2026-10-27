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
- [ ] **Per-business database logins on (ADR-055).** Set `TENANT_LOGIN_SECRET` (`openssl rand -hex
  32`) for web and worker, then run `pnpm --filter @bizr/worker run tenant-logins` once. This is
  required on managed Postgres, where `set_config` can't be locked (ADR-054). `pnpm preview:check`
  reports the state.
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
   - `CONNECTOR_SECRET` (`openssl rand -hex 32`; encrypts linked sources' tokens, ADR-058), and the
     Shopify app's `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` (`docs/RUNBOOK_SHOPIFY.md`)
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

The `s3` driver is built (M17, ADR-067). It works with any S3-compatible store, signs requests
itself, and writes each file once under its fingerprint.

1. Create a **private** bucket and a key that can only read, write, list and delete in that bucket.
   - R2: an R2 API token with "Object Read & Write" for the one bucket.
   - AWS: an IAM user with `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on it.
   - Both encrypt objects at rest by default; leave that on.
2. Set the bucket's settings (`.env.example`, File storage) where the move will run, alongside the
   current `STORAGE_DRIVER`:
   - R2: `S3_BUCKET`, `S3_REGION=auto`, `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`,
     `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
   - AWS: `S3_BUCKET`, `S3_REGION`, and the key; no endpoint
3. Check first, then move the existing uploads:
   ```
   pnpm --filter @bizr/worker run storage:move -- --to s3 --dry-run
   pnpm --filter @bizr/worker run storage:move -- --to s3
   ```
   - Every file the uploads point to is copied and checked against its fingerprint.
   - Nothing is deleted from the old store, and running it again only checks.
   - It exits with an error if a file is missing or damaged. Look at those before switching.
4. Set `STORAGE_DRIVER=s3` on the web app and the worker, and redeploy.
5. Run the move once more: it picks up anything uploaded between the move and the switch.
6. Keep the old store for a week. Then empty `app.storage_blob` (Stage 1) or the local folder
   (Stage 0).

## 5. Errors and monitoring (Sentry)

1. Add the Sentry SDK to web and worker behind `SENTRY_DSN` (not built yet; logs only until then,
   OPEN_QUESTIONS Q15). Scrub request bodies: uploads and cell values must never leave our systems
   except as masked samples to the AI provider (ADR-020).
2. Uptime check on `/api/health` every minute, alerting the founders.
3. Weekly: open `/admin` for AI spend per business, failed AI checks, query and job failures.

## 6. Domain and email

1. Point the domain at the web host; HTTPS on.
2. Verify the sending domain in Resend (SPF, DKIM, DMARC). Test the sign-up verification, password
   reset and invite emails, a weekly summary and an urgent alert, and both unsubscribe paths (the
   link's button and a mail app's one-click unsubscribe, ADR-057).
3. Google sign-in: follow `docs/RUNBOOK_GOOGLE_OAUTH.md` with the production redirect URL.

## 7. Go-live checks

- [ ] Sign up, onboarding, "Try the demo shop", a real import, Ask, dashboard, insights, invite a
  member, re-upload, undo, downloads (an answer, a tile, all my data), delete the business. All on a
  phone too.
- [ ] `pnpm perf <slug>` against production: Home LCP ≤ 2 s, Ask p95 ≤ 6 s (PLAN M8).
- [ ] `/admin` shows AI calls as live (not replayed) and within the caps.
- [ ] A test business is deleted and its tenant schema and roles are gone.

## 8. Rolling back

- **Web:** promote the previous deployment in the host's dashboard. Migrations are additive, so the
  previous version runs on the newer database.
- **Worker:** redeploy the previous image; queued jobs resume from their checkpoints.
- **Database:** point-in-time restore to just before the release, only if data was damaged. This loses
  writes since then: tell affected owners.
