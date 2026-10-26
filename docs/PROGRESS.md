# Progress Log

## Current Status

- **Milestone:** M9 (Ready for a first real customer, $0) is **built and checked automatically**. It needs the owner's confirmation. M8's two person-only items are still open:
  - the two timed presenter rehearsals and the backup screen recording (Q24)
  - the optional free hosted preview (Q19). It is ready apart from the accounts: `docs/RUNBOOK_PREVIEW.md`, `pnpm preview:check`.
- **Branch:** `claude/elegant-hopper-dtc9gi`.
- **New in M9:**
  - **Per-business database logins (ADR-055):** with `TENANT_LOGIN_SECRET` set, each business's statements run under its own login, which can become only that business's roles. Backfill and rotation: `pnpm --filter @bizr/worker run tenant-logins`.
  - **Downloads (ADR-056):** every answer and dashboard tile as Excel or CSV, and "Download all my data" on My data (one tab per kind of record). Each file has an "About this file" tab with the question, dates and assumptions. Money stays exact; CSV text is guarded against formulas.
  - **Emails (ADR-057):** the weekly summary and new urgent alerts, to confirmed members only. Each person chooses in Alert settings → "Emails to you", and every email has a one-click unsubscribe. Each email goes at most once. Without `RESEND_API_KEY` they are only logged.
- **Also today:** Next.js 16.4.3 (security), `pnpm audit` in CI, managed-Postgres setup (ADR-054).
- **Tests:** 730 unit/integration pass; 31 e2e pass (desktop + mobile; 3 desktop-only skipped on mobile). CI green through 29c7ad0; later pushes are running.
- **Performance** (production build, demo shop, M8):

  | Measure | Result | Target |
  |---|---|---|
  | Home LCP | p50 about 200 ms | ≤ 2 s |
  | Ask | p95 under 300 ms | ≤ 6 s |
  | Dashboard tiles | p95 154 ms | ≤ 1.5 s |

- **Evals (rules only, $0):**

  | Suite | Result |
  |---|---|
  | Ingest | 11/11 |
  | Questions | 0.919 (demo subset 1.0) |
  | Dashboard edits | 0.932 |
  | Record writes | 1.0 |
  | Change plans | 1.0 |

- **Waiting on the owner:**
  - confirm M9
  - presenter rehearsals and the backup recording (Q24)
  - the Google OAuth client (`docs/RUNBOOK_GOOGLE_OAUTH.md`)
  - the Anthropic API key (Q20)
  - before real customers' emails: a Resend account and a verified sending domain (Q25)
- **Spend to date:** $0 infrastructure, $0 AI.

---

## Session log

### 2026-10-26 — Session 13: M9 built (business logins, downloads, emails)

**Completed:**

- **Per-business database logins** (ADR-055, commit 29c7ad0). Tested on a database without a superuser; CI runs with them on.
- **Downloads** (ADR-056):
  - `@bizr/core/export`: sheet builders, a CSV writer (BOM, RFC 4180 quoting, formula guard) and an Excel writer (exceljs, already used by imports): bold frozen header, money and percent formats, real dates, an "About this file" tab.
  - Answers export the rows the owner saw. Tiles run for the dashboard's dates. "Download all my data" reads each record type in batches by id (up to 100,000 each), shows linked records by name and coded values by label, and is logged as `data.downloaded`.
  - Routes under `/api/w/<slug>/…/download`, each checking membership. Links on the answer card, the tile menu and My data.
  - Fixed `shiftDecimal` for shifts past the last digit.
- **Emails** (ADR-057):
  - `sendEmail` moved to `@bizr/platform` (HTML, headers, a test transport) and is shared with the auth and invite emails.
  - Migration 0015: `email_preference` and `email_delivery`.
  - `sendInsightEmails` runs after every insight run in all three job paths and never fails the run.
  - Signed one-click unsubscribe: `/api/email/unsubscribe` (RFC 8058 POST) and a confirm page at `/email/unsubscribe`.
  - "Emails to you" in Alert settings.
- **Tests:**
  - new unit tests (writers, email content, signatures)
  - integration tests on the demo business (exact values in files; once-only sending, confirmed members only, unsubscribe, demo shops silent)
  - e2e `downloads.spec.ts` and `emails.spec.ts`
  - full suite: 730 unit/integration, 31 e2e

**In progress:** nothing.

**Blockers:** none for building. Real emails need a Resend account and a verified domain (Q25).

**Next steps:**

1. Owner: confirm M9; the M8 rehearsals (Q24); the API key (Q20).
2. Before a first real customer: Resend account plus sending domain (Q25), and `TENANT_LOGIN_SECRET` wherever it is hosted.
3. After confirmation: the roadmap in PLAN, as the owner prioritises (connectors first is the default).

### 2026-10-26 — Session 12: M8's free hosted preview made ready; security fixes

**Completed:**

- **Managed Postgres (ADR-054):**
  - `db:setup` works without a superuser, as on Neon: no `NOSUPERUSER` restating, self-membership of the roles it creates, and a checked (not assumed) `set_config` lock-down, with a note when it can't be done.
  - The executor compares role, search path and time limit before and after every tenant statement, and refuses a change.
  - The isolation test accepts either refusal.
- **Proof without accounts:**
  - a Neon-like database (an owner with `CREATEROLE` and `CREATEDB` only) passes setup, migrations, the full suite (707), and `preview:check`
  - on that database, a production build with Postgres file storage and inline jobs passes the demo rehearsal (49.7 s) and the quality spec
- **Preview pieces:**
  - `apps/web/vercel.json` (daily cron to the drain route with `?maintenance=1`)
  - `pnpm preview:check`
  - `docs/RUNBOOK_PREVIEW.md` (owner steps marked; demo data only)
- **Security:**
  - The build stopped on a Next.js advisory. `pnpm audit` confirmed two critical remote-code-execution issues and one denial-of-service issue in Next.js up to 16.4.0.
  - Upgraded `next`, `@next/env` and `@next/eslint-plugin-next` to 16.4.3.
  - Added `pnpm audit --prod --audit-level high` to CI.
  - Two moderate advisories remain in dependencies we don't use that way (R34).
  - The build tool also suggested running its own upgrade command; I didn't run it, and used the npm advisory data and a normal version bump instead.
- **Demo:** the review now asks first about the customer name written the most ways ("Bloom & Co", three spellings). Otherwise the question moved with the date ("Juniper House" on 2026-10-26).
- **Docs:** ADR-054; RUNBOOK_PRODUCTION prerequisites (per-tenant login roles on hosts without a superuser; clean audit); OPEN_QUESTIONS Q19 updated, R33 and R34; PLAN note; CLAUDE.md command.

**In progress:** nothing.

**Blockers:**

- The preview needs the owner's accounts and a decision on the host's terms (Q19).
- The presenter rehearsals need a person (Q24).

**Next steps:**

1. Owner: decide on the preview (Q19). If yes, follow `docs/RUNBOOK_PREVIEW.md`; I can run the checks once the settings exist.
2. Owner: presenter rehearsals and the backup recording (Q24).
3. Then M8 can be closed, and the roadmap prioritised. Per-tenant login roles (ADR-005 option 3) come before any real customer data on a managed host.


### 2026-10-16 — Session 11: M8 Demo readiness

**Completed:**

- **Demo shop** (`@bizr/core/demo`, ADR-051): `startDemoShop`, `finishDemoImport`, `removeDemoShops`, `demoFiles`, `demoNextMonthFile`.
  - "Try the demo shop" on onboarding
  - "Your businesses" on More and Settings
  - the "Demo" badge
- **`pnpm demo:up`** (`apps/worker/src/cli/demo-up.ts`). New env settings: `DEMO_EMAIL`, `DEMO_PASSWORD`, `ADMIN_EMAILS`.
- **Data quality found by the rehearsal:**
  - merged customers keep their most common spelling
  - demo stockists mostly use their own spelling
  - stockist invoices are left out of the weekly sales change
- **Performance pass:** `pnpm perf <slug>`. All targets met with a wide margin; indexes reviewed, no changes needed (ADR-052).
- **Polish pass:**
  - the copy linter
  - not-found and error pages, loading skeletons, a favicon
  - the iPhone SE and accessibility e2e, plus the contrast, chip-wrapping and link fixes it found
- **Admin page** (`/admin`, ADR-053).
- **Rehearsal:** `e2e/demo.spec.ts` follows DEMO_SCRIPT §2 and records each scene's time. It passed twice in a row with AI off.
- **Docs:**
  - DEMO_SCRIPT: setup via `demo:up`, today's questions and sentences, the re-upload scene, the rehearsal checklist
  - `docs/RUNBOOK_PRODUCTION.md` (Stage 2, not executed)
  - ADR-051 to ADR-053
  - PLAN M8 ticked
  - OPEN_QUESTIONS: Q24, R31, R32
- **Full eval run:** results in Current Status, unchanged from the baselines.

**In progress:** nothing.

**Blockers:** none. The presenter rehearsals need a person (Q24).

**Next steps:**

1. Owner: two timed rehearsals with `pnpm demo:up`, and the backup screen recording (DEMO_SCRIPT §5).
2. When the key arrives (Q20): the AI eval runs, replay recordings for the demo path, and the Task J faithfulness sample.
3. After M8 is confirmed: the M9+ backlog in PLAN (connectors, more vertical packs), as the owner prioritises.


### 2026-10-16 — Session 10: M7 Insights built

**Completed:**

- **Pack format** (`@bizr/packs` `insights.ts`, ADR-047). This adds:
  - `insights.yaml` with nine rules
  - four new measures: items returned, supplier cost per item, days since last order, days overdue
  - cross-file checks
- **Close-name linking** in imports: "Sage Mug" → Sage Stoneware Mug when every word matches exactly one record. This closes most of R20.
- **Engine** (`@bizr/core/insights`):
  - pure `evaluate.ts` and `render.ts`
  - `runInsights` through the executor (origin `insight`)
  - the lifecycle (ADR-048)
  - migrations `0013_insights` and `0014_insight_phrasing`
- **Jobs and triggers:**
  - `insights.run` and `insights.daily`
  - the insights step at the end of `ingest.apply` and `ingest.merge`
  - `requestInsightRun` from web actions
  - `scheduleDailyJobs` from the drain cron and the worker
- **Weekly digest** (`digest.ts`), written by the first run of each week.
- **Task J** `phrase_insights@v1` (ADR-049): checked rewording, kept and refilled. The pack sentences show without AI.
- **UI:** Home (key numbers, Ask box, digest, feed), All insights, Alert settings, and nav and More links. The Change history link on More is fixed. Mobile layout checked by screenshot (no sideways scrolling).
- **Demo data:** `stories: false` control business, plus knowable truth figures (ADR-050).
- **Tests:**
  - 704 unit/integration, including the M7 acceptance test and lifecycle checks
  - 22 e2e: the import journey now covers the feed, dismiss, the Ask hand-off, alert settings and topic filters
- **Docs:** ADR-047 to ADR-050; PLAN M7 ticked; OPEN_QUESTIONS Q22, Q23, R29, R30 (R20 and R26 updated); ARCHITECTURE jobs table; VERTICAL_PACKS §2.7 thresholds.

**In progress:** nothing.

**Blockers:** none. The AI paths wait on the key (Q20).

**Next steps (after the owner confirms M8):**

1. M8 demo readiness: `pnpm demo:up`, a seeded demo business with insights already generated, the demo script run-through, and the free-preview platform cron for `?maintenance=1`.
2. When the key arrives: the AI evals (Q20) and a Task J faithfulness sample.


### 2026-10-16 — Session 9: M6 Data upkeep built

**Completed:**

- **Merge engine** (`@bizr/core/merge`, ADR-043): the pure diff (new / changed / unchanged /
  missing / conflicts / repeated keys), `mergeWrites` (inserts and updates only), and the service
  (source signatures, reused mappings, scoped "missing", link resolution on insert).
- **Edit log** (`@bizr/core/records/edits`): the tenant `_record_edit` table, `logEdits` and
  `undoBatch`.
- **Re-upload pipeline:** migration `0010_reupload` (`data_source`, `merge_preview`, run statuses
  `merge_review` / `merging`, `undone_at`). The `ingest.merge` job, the merge preview,
  `mergeRun` and `undoRun`.
- **Re-upload UI:** "This looks like a newer version of …" on review, "Here's what would change"
  with examples, the missing list and conflict choices, then the update report with "Undo this
  update".
- **Records** (`@bizr/core/records`): list types, browse (search, filters, sort, paging),
  open (links, lineage, history), type-checked edits, soft delete, restore and undo.
- **Records UI:** record-type cards on My data, a virtualised grid with sticky header and first
  column, type-aware editors, the side panel, "Recently deleted", and phone cards.
- **Demo data:** `pnpm demo:generate --next-month DIR` writes next month's website export and its
  truth file.
- **Tests:** 634 unit/integration (up from 610), including the re-upload and records integration
  suites, and 22 e2e (re-upload and records journeys, desktop and mobile).

**Bugs found and fixed:**

- The merge preview counted every order as changed: stored date-times (UTC) were compared as text
  with the file's local-offset strings. They are now compared as instants.
- `pnpm eval` (all suites) crashed after the question suite: `getAppDb()` kept a client on a pool
  that had been closed. It now rebuilds when the pool changes.
- The review screen never showed what the analysis had spotted; it now lists it.

- **Structural changes** (ADR-044):
  - new ops: renames, kinds, allowed values and unlinking
  - snapshots before destructive changes (`app.snapshot`, migration `0011`)
  - impact counted from the data, including measures and charts that would stop working
  - an undo stack restoring from inverses or snapshots
  - `snapshot.gc`
- **Change history page** with Undo, and a warning when data entered since would be lost.
- **By chat** (ADR-045):
  - Task H (record writes) and Task I (change plans): rules, lookups with "Which … do you mean?", cards built by code, then `plan_record_write@v1` and `plan_change@v1`
  - the My data box
  - Ask's hand-off
  - eval suites `records` (44) and `changes` (33), with CI tests and baselines
- **People** (ADR-046): invite by link (migration `0012`), the invite page, owner-only checks in core.
- **Tests:** 676 unit/integration and 20 e2e journeys (desktop and mobile), all green.

**More bugs found and fixed:**

- Text → whole number conversions were described as "rounded" when the values actually become blank.
- Removing a detail that tells records apart now says why instead of "couldn't work out".
- Ask answered "Rename sales to orders" as a sales question; it now recognises change requests.

**Next steps:** owner review of M6; then M7 (Insights), whose daily platform cron also runs `snapshot.gc`. With the API key (Q20): AI eval runs for all five suites.

### 2026-10-16 — Session 8: M5 Dashboards built

**Completed:**

- **Pack:** `dashboard.yaml` (schema, checks, retail's 13 tiles) next to `questions.yaml`.
- **Storage:** migrations `0008_dashboards` (`dashboard_version`, dashboard settings, tile pack keys
  and options, `workspace.data_version`) and `0009` (one default dashboard per workspace).
- **Core** (`@bizr/core/dashboard`, ADR-042):
  - the pure model: tiles, edit ops, `applyOps`, `packTilesFor`, `tileSpec` (dates, compare,
    auto-grain)
  - the service: generation after every import, edits as versions, undo, saved date range, live
    tiles with a data-version cache, blank groups left out with a note
  - Task G: the rules planner and `plan_dashboard_edit@v1`, with checks, one repair and a preview
- **Web:**
  - the dashboard page: date picker, compare toggle, Undo, "Change this dashboard" with preview,
    Apply and Cancel, an "Unlock more" card, a loading skeleton
  - tiles: a menu, a fixed-date badge and compact headline numbers
  - Ask's "Add to dashboard" now saves a version; Ask takes `?q=` for "Ask about this"
- **Evals:** `evals/dashboard/retail.yaml` (44 cases), `--suite dashboard`, a rules-only CI test
  and a baseline.
- **Tests:** 610 unit/integration (up from 590) and 16 e2e. The e2e now covers the default dashboard,
  the date range, a chat edit with preview, apply and undo, and removing a tile from its menu.

**Bugs found and fixed:**

- Sideways bar charts drew their axes but never their bars: the grow-in animation never finished.
  Charts now draw without animation.
- Headline numbers in tiles sat in nested cards and the comparison dates wrapped badly. Tiles now
  use a compact layout.
- "Not recorded" groups topped dashboard lists ("Running low" showed a 0-day product).

**Blockers:** none for building. The AI paths still need the API key for a live run (Q20).

**Next steps:**

1. When the key arrives: the AI question and dashboard edit evals (`--ai --limit`), with baselines.
2. On the owner's go-ahead, M6 (Data upkeep): re-uploads with merge, browse and edit records,
   and changes to what's tracked.

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
