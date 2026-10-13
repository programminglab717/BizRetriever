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
| Q1 | P0 | **Demo date and team.** When is the first investor demo? Is anyone else contributing? | Assume ~8–10 weeks of focused work; solo engineer + owner. The demo-critical path (★ in PLAN) is protected; cuttable items move after the demo if needed. | — |
| Q2 | P0 | **Git workflow.** `main` has no commits. Bootstrap `main` with these docs, or PR from the feature branch? | Docs committed on `claude/elegant-hopper-dtc9gi`; PR into `main` only when the owner asks. Each milestone afterwards gets its own feature branch + PR. | — |
| Q3 | P0 | **Hosting vendors.** OK with Vercel + Neon + Railway (worker) + Cloudflare R2? Existing accounts? | Yes, as proposed. Local dev needs none of them. | ADR-016 |
| Q4 | P0 | **Background jobs.** pg-boss + a separate worker (needs Railway or similar), or a hosted queue (Inngest/Trigger.dev) to avoid running a worker? | pg-boss + Railway worker. | ADR-011 |
| Q5 | P0 | **Auth library.** Better Auth (self-hosted), or Clerk (hosted, paid, fastest)? | Better Auth. | ADR-012 |
| Q6 | P1 (M1) | **Transactional email provider** for verification/reset (and later digests). | Resend; console logging in dev. | ADR-012 |
| Q7 | P1 (M1) | **Default currency and locale.** Is the first market the US, UK, or elsewhere? Affects demo currency, date order and copy (e.g. "sales tax" vs "VAT"). | USD, MDY dates, US English; all configurable per workspace. | ADR-025 |
| Q8 | P1 (M2) | **Privacy.** OK to send masked column samples (names visible; emails/phones masked) to Anthropic? Any data-residency (EU) or zero-data-retention requirement? | Yes, with masking on by default; no residency constraint for the MVP. | ADR-020 |
| Q9 | P1 (M2) | **Upload limits.** 25 MB / 200k rows per sheet / ~2M rows per workspace OK? | Yes. | ADR-024 |
| Q10 | P1 (M2) | **AI cost budget.** Target AI cost per active workspace per month? | ≤ $5/month at ~100 questions + weekly uploads; strong model only for data modeling and change plans. | ADR-010 |
| Q11 | P1 (M2) | **File retention.** How long do we keep original uploaded files? | Keep for the life of the workspace (enables re-processing and lineage); delete with the workspace. | ADR-013 |
| Q12 | P1 (M8) | **Branding.** Is "BizRetriever" final? Logo, colours, design references? | Neutral shadcn theme + placeholder wordmark until provided. | — |
| Q13 | P1 (M8) | **Demo mode honesty.** Is AI replay for the demo workspace acceptable to you? It is a resilience mechanism; live calls are used on cache misses and for real users. | Yes, with live import shown first and replay only as a safety net. | ADR-021 |
| Q14 | P1 (M8) | **Public demo.** Presenter-only, or a public "Try the demo shop" link investors can use themselves? | Presenter-driven, plus one-click demo for any signed-up user. A public no-signup demo is a later option (abuse/cost controls needed). | — |
| Q15 | P2 | **Error tracking / product analytics.** Sentry? PostHog? | Sentry in M8; PostHog later. | — |
| Q16 | P2 | **Terminology check with real users.** Do owners say "orders" or "sales", "stock" or "inventory"? (Varies US/UK.) | UI uses "sales" and "stock" with locale-aware variants later; validate in 3–5 user interviews. | — |
| Q17 | P2 | **Pricing model** (informs cost tracking and limits). Per workspace, per seat, usage tiers? | Track AI cost per workspace from day one; decide later. | — |

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
| R13 | **Messy data the profiler can't structure** (pivot tables, images, multiple tables side by side) | Medium | Medium | Region detector handles multiple blocks; graceful "we couldn't read this part" with a skip option; collect such files for future work |

---

## Resolved

| # | Date | Question | Decision |
|---|---|---|---|
| — | 2026-10-13 | Target vertical: Shopify merchants vs retail generally | **Retail & Ecommerce sellers with messy data** (online, marketplace, physical shop, multi-channel, light wholesale). Shopify/Etsy/POS exports are recognised formats inside the pack. (ADR-001) |
