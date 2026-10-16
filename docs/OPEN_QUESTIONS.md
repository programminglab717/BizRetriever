# Open Questions and Risks

These are open items for the owner to decide. Each has the engineer's default, which is used until it's
overridden. When an item is decided, move it to "Resolved" with the date, and update the matching ADR in
`docs/DECISIONS.md`.

**Priority:**

- **P0**: needed before M0/M1 starts
- **P1**: needed before the milestone named
- **P2**: can wait

---

## Open questions

| # | Pri | Question | Default (in use until decided) | ADR |
|---|---|---|---|---|
| Q24 | P1 (M8) | **Presenter rehearsals and the backup recording.** The automated rehearsal runs the whole script twice in a row with AI off (38.5 s and 33.1 s of machine time). Two timed run-throughs by the presenter (talking included, target ≤ 7 min) and a 3-minute backup screen recording need a person at the laptop. Who presents, and when? | Use `pnpm demo:up`, read the numbers it prints, and fill in DEMO_SCRIPT §5. | ADR-051 |
| Q22 | P2 | **Should a dismissed insight come back if it gets much bigger** (dead stock doubling, more overdue money) while its level stays the same? | No: dismissed stays hidden until it gets more serious (warn → urgent) or stops and starts again after its cooldown. | ADR-048 |
| Q23 | P2 | **Trends when the latest upload is older than today.** If sales stop a few days before today (a monthly export), "last 7 days" compares a part-empty week and can say "sales down". Should trend rules count from the last day with sales instead? | Rules count from today; the "Big changes in weekly sales" alert is at most "Worth a look", never urgent. | ADR-047 |
| Q21 | P2 | **Should members be able to change what's tracked** (add or remove details, Journey 6), or only owners? | Members can (PRODUCT_SPEC §5: everything except billing, deleting and inviting). Every change needs confirmation, is undoable and records who made it. | ADR-046 |
| Q20 | P1 (M4, now) | **Anthropic API key and the first paid eval runs.** The AI paths (Tasks A–I) are built and tested with fake providers only. M6 adds the record write (44) and change plan (33) suites: `pnpm eval -- --suite records --ai --limit 20` and `--suite changes --ai --limit 20` (well under $1 each). Ask works without AI (rules answer 81% of the 185 eval questions outright, 92% correctly with best guesses), but unclear wording, weekday questions and the SQL fallback need the AI. When can we get the key? First runs: `pnpm eval -- --suite questions --ai --limit 40` (≈ $1) and the ingest eval (well under $5). | Keep running rules-only. The demo script passes 100% without AI. | ADR-027, ADR-033, ADR-040 |
| Q19 | P2 (M8) | **Free hosted preview platform.** Vercel Hobby's terms restrict it to non-commercial use. Is a pre-revenue investor preview OK there, or should we use a free tier that allows commercial use (e.g. Cloudflare Workers via the OpenNext adapter, Netlify)? Only matters if we want a shareable link before revenue. | Demo from a laptop (Stage 0). Decide this only if a hosted link is needed; re-check current terms then. | ADR-016 |
| Q12 | P1 (M8) | **Branding.** Logo, colours, design references? | Neutral shadcn theme + placeholder wordmark until provided. | — |
| Q16 | P2 | **Terminology check with real users.** Do owners say "orders" or "sales", "stock" or "inventory"? (Varies US/UK.) | "Sales" and "stock"; validate in 3–5 user interviews. | — |
| Q17 | P2 | **Pricing model.** Per workspace, per seat, usage tiers? | Track AI cost per workspace from day one; decide later. | — |

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **AI data modeling is wrong on real-world files** (beyond our fixtures), hurting first impressions | Medium | High | Dry run before review; ≤ 3 targeted questions; easy corrections; growing fixture corpus from real (anonymised, consented) files; eval regression gate |
| R2 | **Ambiguous dates silently mis-parsed** (03/04) | High | High | Workspace date order + per-column evidence (values > 12) + assumption shown on the review screen |
| R3 | **Tenant isolation bypass via the SQL fallback** | Low | Critical | Spec-first path; libpg-query AST allowlist; per-tenant roles; READ ONLY; adversarial suite; planned per-tenant login roles (ADR-005) |
| R4 | **Merging re-uploads without stable keys** creates duplicates or false changes | Medium | High | Pack natural keys; user-confirmed key; hash fallback routed to review; never auto-delete; undoable merges |
| R5 | **Lossy rollbacks** confuse users | Medium | Medium | Lossy-rollback detection; explicit dialog with counts; snapshots; integration tests per op |
| R6 | **Fuzzy dedupe merges different customers** ("J Smith") | Medium | Medium | Suggestions only, user-confirmed; conservative thresholds; unmerge available |
| R7 | **Latency of the strong model** pushes onboarding past 2 minutes | Medium | Medium | Parallel per-sheet profiling; known-format fast path (no AI needed for recognised exports); streamed progress; prompt caching; evaluate the standard tier at high effort |
| R8 | **Schema-per-tenant scaling** (catalog bloat at thousands of tenants) | Low (MVP) | Medium | Shard tenants across databases; workspace records its DB; revisit at ~2k workspaces |
| R9 | **Prompt injection via uploaded content** | Medium | Medium | Delimited data blocks, sanitising, schema-constrained outputs, id validation, human gate on writes, canary evals |
| R10 | **Scope creep** across M0–M8 delays the demo | High | High | Demo-critical path; cuttable items marked; milestone gates with owner confirmation |
| R11 | **Narration feels stilted** because of the placeholder constraint | Low | Low | Facts include labels and comparisons; phrasing eval; deterministic templates as fallback |
| R12 | **Vendor model changes** (model IDs, API behaviour) | Medium | Low | Model IDs in env; provider abstraction; eval suite run before changing models |
| R14 | **Free-tier limits or terms change** (storage, compute hours, function duration, commercial-use clauses) | Medium | Low–Medium | Stage 0 local is the default; free preview is optional; staged design means switching vendors is config; re-verify before Stage 1 |
| R15 | **AI spend creeps up** during development | Medium | Low | Hard budget guard, replay-only tests/CI, on-demand evals with cost estimates, cheapest tier that passes evals |
| R16 | **Hosted Postgres may not allow revoking `set_config` from PUBLIC** (needs superuser-level rights; part of tenant isolation, ADR-005 amendment) | Medium | High | Verify on Neon before Stage 1; fallback is per-tenant login roles (ADR-005 option 3) |
| R17 | **The live AI path is untested against the real API** (structured-output schema limits, latency, cost) | Medium | Medium | Fake-provider tests cover the fallbacks; first live eval run as soon as the key arrives (Q20); every failure falls back to the rule-based proposal |
| R18 | **Eval cases overfit the rule-based proposer** (written while building it) | High | Medium | Add real anonymised files as they arrive; keep the AI eval separate; track rules-only and AI baselines apart |
| R19 | **A long AI call exceeds a serverless function's time limit** in inline mode (free preview) | Medium | Medium | Rules-first means most imports make no AI call; the worker mode has no limit; split proposals per table if needed |
| R20 | **Item names that differ between files** (till "Sage Mug" vs stock list "Sage Stoneware Mug") don't link to a product, so product-level numbers (days of cover, margins by product) undercount | Medium | Medium | Since M7, a short name links when every word matches exactly one record ("Sage Mug", "Candle Sml"), and the data report says so; the demo now links over 99% of till lines. Unmatched links are kept and reported; a "these look like the same product" fix screen is still to come |
| R21 | **Rule-based answers that are confidently wrong.** The rules answer most questions without AI; a misread question that still looks fully understood skips the AI | Medium | High | The 185-case eval scores rules alone and fails CI on any drop; confident misses found so far became tests; every answer shows its assumptions and "How I calculated this"; 👎 reasons are stored for review |
| R22 | **Ask latency with the AI on** is unmeasured. Rules path p95 is under 0.1 s for interpretation and query; the AI adds interpretation (standard tier) and narration (fast tier) calls | Medium | Medium | Measure in the first AI eval run (Q20); narration can be skipped for simple shapes (code's sentence is always available) |
| R23 | **Sales without a customer or product** (till sales, unlinked items) group as "Not recorded" and can top a ranking chart | High | Low | Headlines skip blank groups; the chart and table keep them so totals stay honest; M5's product-matching fix (R20) shrinks the product case |
| R24 | **Tile cache is per server instance.** On the free serverless preview, cold starts run every tile again (13 queries per dashboard view) | Medium | Low | Tiles run in parallel as the tenant reader and the demo dashboard loads in about a second locally; add a shared cache only if hosted latency needs it |
| R25 | **No custom date range in the picker yet.** PRODUCT_SPEC §3 lists "Custom"; the range model and URL support exact dates, but the picker only offers presets | Low | Low | Add a from/to picker when someone asks; fixed-date tiles already cover named periods |
| R26 | **`snapshot.gc` needs the daily cron.** Scheduled since M7 (ADR-048): the drain cron and the worker queue it daily; on the free preview the platform cron must be set up (M8). Until then, backups older than 30 days stay | Medium | Low | Queue it by hand (`pnpm --filter @bizr/worker run snapshot:gc`); snapshots are small at SMB scale |
| R29 | **The e2e demo data is fixed at 2026-10-13 while the clock moves on.** Date-relative insights (stock-out, slipping customer) drift as real time passes | High | Low | The e2e only relies on dead stock, which stays true; the M7 integration test pins "today" to the demo's date |
| R30 | **False "regular customer buying less" for customers who order rarely** | Medium | Medium | Thresholds: ≥ 3 orders and ≥ $200 usual spend per two months; owners can change both in Alert settings; "Not useful" feedback is stored for review |
| R31 | **The `s3` file storage driver isn't built.** Paid production (Stage 2) needs it; local and Postgres storage work today | Certain (at Stage 2) | Medium | Listed as step 4 of `docs/RUNBOOK_PRODUCTION.md`, with a MinIO-based test; nothing to do before revenue |
| R32 | **Demo numbers change with the day.** The demo is generated for today, so the script's exact figures differ per day | Certain | Low | `pnpm demo:up` prints the day's import counts and Home's sentences; the stories (stock-out within a week, Bloom & Co slowing, the napkin cost rise) hold every day, and a test checks them for today |
| R27 | **Chat rules misreading a write.** A rule could read a request slightly wrong (wrong product among similar names, a number taken as a price) | Medium | Medium | Nothing is written without the card, which shows every value, item, total and assumption; similar names get a question; writes are undoable; 77 eval cases run on every CI build |
| R28 | **Lossy kind changes on big tables** lock the table while it converts | Low | Medium | SMB tables are small; the change runs in one transaction with a snapshot; the impact counts values that won't convert first |
| R13 | **Messy data the profiler can't structure** (pivot tables, images, multiple tables side by side) | Medium | Medium | Region detector handles multiple blocks; graceful "we couldn't read this part" with a skip option; collect such files for future work |

---

## Resolved

| # | Date | Question | Decision |
|---|---|---|---|
| Q18 | 2026-10-13 | AI API budget during the build | Hard caps of $2/day and $15/month (ADR-027). The owner will provide the API key when M2 needs it. |
| — | 2026-10-13 | **Zero-cost rule** | Free options only until production and revenue; AI API is the one capped exception (ADR-026, ADR-027). |
| Q1 | 2026-10-13 | Demo date and team | Default accepted: plan for ~8–10 weeks, solo engineer + owner; protect the ★ path. |
| Q2 | 2026-10-13 | Git workflow | Default accepted: work on feature branches; PR into `main` only when the owner asks. |
| Q3 | 2026-10-13 | Hosting vendors | Amended by the zero-cost rule: staged hosting (local → free preview → paid production after revenue) (ADR-016). |
| Q4 | 2026-10-13 | Background jobs | pg-boss with worker mode + free serverless drain mode (ADR-011). |
| Q5 | 2026-10-13 | Auth library | Better Auth (ADR-012). |
| Q6 | 2026-10-13 | Email provider | Console locally; Resend free tier when hosted. |
| Q7 | 2026-10-13 | Currency/locale | USD, MDY dates, US English defaults; configurable per workspace (ADR-025). |
| Q8 | 2026-10-13 | Privacy | Masked samples to Anthropic OK; no residency constraint for the MVP (ADR-020). |
| Q9 | 2026-10-13 | Upload limits | 25 MB / 200k rows per sheet / ~2M rows per workspace (ADR-024). |
| Q10 | 2026-10-13 | AI cost per workspace target | ≤ $5/month per active workspace in production; build-phase cap tracked under Q18. |
| Q11 | 2026-10-13 | File retention | Keep originals for the life of the workspace (ADR-013). |
| Q13 | 2026-10-13 | Demo replay | Accepted as a safety net; live import shown first (ADR-021). |
| Q14 | 2026-10-13 | Public demo | Presenter-driven + one-click demo for signed-up users. |
| Q15 | 2026-10-13 | Error tracking / analytics | Logs only during the zero-cost phase; Sentry in paid production (free tier optional earlier). |
| — | 2026-10-13 | Target vertical: Shopify merchants vs retail generally | **Retail & Ecommerce sellers with messy data** (online, marketplace, physical shop, multi-channel, light wholesale). Shopify/Etsy/POS exports are recognised formats inside the pack. (ADR-001) |
