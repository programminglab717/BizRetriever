# Runbook: the free hosted preview (Stage 1)

**What it is:** a shareable link to BizRetriever with the demo shop, at $0 (ADR-016). It is optional:
the investor demo runs on the presenter's laptop (`pnpm demo:up`). Build it only if a link is needed
before revenue.

**Status:** everything that needs no account is ready and tested (ADR-054). The steps marked **Owner**
need an account, or terms to accept, and are the owner's to do or approve.

**Use it for demo data only.** On a managed Postgres host the database can't fully lock down one
built-in function. Isolation then rests on the SQL checks and the executor's session check (ADR-054),
which is fine for the demo shop but not for real customers' data.

---

## 0. Decide (Owner)

- [ ] **Which host for the web app (Q19).** The default is Vercel Hobby. Its terms have restricted
  Hobby to non-commercial use, so check them on the day: is a pre-revenue investor preview allowed?
  If not, pick another free Next.js host whose terms allow it.
- [ ] **Neon Free for the database.** As checked on 2026-10-26: 0.5 GB storage, 100 compute-hours a
  month, and it sleeps after 5 minutes idle, so the first visit after a pause takes a few seconds.
  The demo shop uses about 6 MB per copy, and "Start again" replaces the old one.
- [ ] **AI on the preview?** Without a key it runs on rules only, which the demo needs. With a key, keep
  the existing caps ($2/day, $15/month).

## 1. Database (Owner: create the project)

1. **Owner:** create a Neon project (Postgres 17, the region nearest the audience). Copy two connection
   strings for the default database: **direct** (host without `-pooler`) and **pooled** (host with
   `-pooler`). Both end with `?sslmode=require`.
2. On your own computer, put the preview's settings in `.env.preview` (ignored by git; never commit
   it):

   ```
   DATABASE_URL_SUPERUSER=<direct string, as the Neon owner role>
   DATABASE_URL_MIGRATE=postgres://bizr_owner:<new password>@<direct host>/<db>?sslmode=require
   DATABASE_URL_ADMIN=postgres://bizr_admin:<new password>@<direct host>/<db>?sslmode=require
   DATABASE_URL_APP=postgres://bizr_app:<new password>@<pooled host>/<db>?sslmode=require
   DATABASE_URL_TENANT=postgres://bizr_tenant:<new password>@<pooled host>/<db>?sslmode=require
   ```

   Make each password with `openssl rand -hex 24`. The roles are created in the next step.
   - The admin and owner roles use the direct host, for creating businesses and migrations.
   - The busy roles use the pooled host. Each serverless instance opens up to about 20 connections,
     and only `SET LOCAL` is used, which is safe with Neon's pooler.
   - If the job queue reports errors through the pooler, move `DATABASE_URL_APP` to the direct host.
3. Run, from the repo:

   ```
   set -a; . ./.env.preview; set +a
   pnpm db:setup        # prints a note about set_config on Neon: expected (ADR-054)
   pnpm db:migrate
   ```

## 2. Web app (Owner: create the project and paste the secrets)

1. **Owner:** import the GitHub repo. Root directory `apps/web`; the framework is detected as Next.js,
   with pnpm. `apps/web/vercel.json` already defines the daily cron (06:17 UTC,
   `/api/jobs/drain?maintenance=1`).
2. Set these environment variables (Production):
   - the four `DATABASE_URL_*` from step 1. Not `DATABASE_URL_SUPERUSER`: the app never needs it.
   - `APP_URL=https://<the preview's address>`
   - `BETTER_AUTH_SECRET` (`openssl rand -hex 32`)
   - `JOB_RUNNER=inline`, `JOB_DRAIN_SECRET` (`openssl rand -hex 32`), and `CRON_SECRET` set to the
     **same value** (the cron sends it as its `Bearer` token)
   - `STORAGE_DRIVER=postgres` (serverless disks don't keep files)
   - `AI_REPLAY_MODE=replay`, or a key plus `off` and the caps if AI is on
   - `ADMIN_EMAILS`, and `RESEND_API_KEY` / `EMAIL_FROM` if invite and reset emails should be sent
     (Resend Free); without them, emails go to the log and invite links are shown to copy
3. Check the host's function time limit on the day. Keep `JOB_STEP_BUDGET_MS` (default 45 s) under it.
   The drain route asks for up to 60 s.
4. Deploy.

## 3. Check it

1. With the same settings as the deployed app (`vercel env pull .env.preview`, then
   `set -a; . ./.env.preview; set +a`), run `pnpm preview:check`. It checks settings, TLS, every role's
   connection, migrations, the job queue, and that a new business can be made. Every probe is rolled
   back. "Ready for the preview" is the goal.
2. Open the link, sign up, click **Try the demo shop**, and go through Home, Ask, Dashboard and
   My data.
3. Next morning: the cron ran (the host's cron log, or `/admin` → Background jobs shows
   `insights.daily` and `snapshot.gc`).

## 4. Take it down

Delete the web project and the Neon project. Nothing else holds data.

---

**Verified without accounts (2026-10-26):**

- A database set up by a non-superuser owner role, like Neon's, passes `db:setup`, `db:migrate`, the
  whole unit and integration suite (707 tests), and `pnpm preview:check`.
- The demo rehearsal passes on a production build using that database, Postgres file storage and
  inline jobs (49.7 s).
