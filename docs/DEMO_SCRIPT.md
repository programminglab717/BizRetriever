# Investor Demo Script

**Target length:** 5–7 minutes.

**Audience:** investors. They should leave believing three things:

1. Small retailers' data really is a mess.
2. BizRetriever turns that mess into answers in minutes, with no technical skill.
3. It is trustworthy: real numbers, shown working, nothing invented.

---

## 1. Setup (before the meeting)

- [ ] Demo runs **locally on the presenter's laptop** (zero-cost rule, ADR-026). Run `pnpm demo:up` at least 10 minutes before. It:
  - starts Postgres (Docker) if needed, then sets up the database
  - makes the sign-in `DEMO_EMAIL` / `DEMO_PASSWORD` (a fresh password is printed if none is set)
  - resets **tab A** (an empty "Fernwood Home & Gift" for the live upload) and **tab B** (the same shop already imported, insights included)
  - writes today's messy files to `demo-files/Fernwood files/` and next month's export to `demo-files/Next month/`
  - starts the web app and the worker with AI in **replay mode** (recordings only; nothing reaches the AI provider)
  - prints the links, the sign-in and **today's numbers**: products, sales, customers, and the insight sentences Home will show. Use those numbers below.
- [ ] Browser zoom at 110%. Notifications off. Laptop on mains power.
- [ ] Two tabs open, signed in: **(A)** the upload screen link, **(B)** the ready shop's Home link.
- [ ] `demo-files/Fernwood files/` open in Finder/Explorer, with Excel ready to open `Stock list & costs.xlsx`.
- [ ] *(Only if a Stage 1 free hosted preview exists)* hosted link open in a third tab as a further backup.
- [ ] Phone with the app open on Home, for the mobile moment (optional).
- [ ] Anyone can also try it themselves: **"Try the demo shop"** on the first screen after sign-up (or More → "Start the demo shop again") makes a fresh copy dated today and imports it live.

---

## 2. Script

Timings are cumulative.

### 0:00 — The problem (≈ 45s)

**Do:** open `Stock list & costs.xlsx` in Excel. Scroll through it.

**Point at:**

- category rows in caps
- "12 pcs"
- the "DISCONTINUED" note row
- the "TOTAL" row

Then flick to `Online orders 2025-26.xlsx`, with its two sheets with different headers and dates.

**Say:**

> "This is Fernwood, a real-world-style home and gift shop. They sell on their website, on Etsy, in their
> own shop, and wholesale to a few boutiques. This is what their data actually looks like: five files,
> different formats, totals in the middle, the same customer spelled three ways. The owner knows the
> answers are in here somewhere. They can't afford an analyst, and they're never going to learn Power BI."

### 0:45 — Upload (≈ 30s)

**Do:** in tab A, drag the whole folder onto the drop zone. Click **"Make sense of my data"**.

**Say:**

> "No templates, no cleanup. They drop in what they have."

While the stages tick by ("Finding the real data — skipping titles, totals and blank lines"), point at the
"What we've spotted so far" teaser:

> "It's recognised the Etsy export, a till export from the shop, and a hand-kept stock list."

### 1:15 — "Here's what we found" (≈ 75s) — the wow moment

**Do:** read the summary card aloud:

> "We found **N products**, **N sales** across **4 channels**, and **N customers**. We'll skip **N rows**
> that look like totals or notes."

**Answer the quick questions, one tap each** (at most three; usually these):

1. *Are “Bloom & Co”, “Bloom and Co.” and “BLOOM & CO LTD” the same customer?* → **Yes, same customer**.
2. *The dates in “Etsy” look day-first. Is that right?* → **Yes**.
3. *Does “Cost” in “Stock list” mean the cost of one item?* → **Yes, per item**.

**Say:**

> "It's done what a data analyst would spend a day on. It found the real tables, skipped the junk, and
> linked orders to products and customers. Where it wasn't sure, it asked. It doesn't guess silently."

**Optionally** expand Products → "Show details" to show the plain mapping ("*Pcs in stock* → Items in
stock"). Then click **"Looks good, set it up"**.

### 2:30 — Data report → Dashboard (≈ 40s)

**Do:** show the data report.

**Say:**

> "Here's exactly what came in, what was skipped and why, and what we assumed. Full honesty."

Point at the assumption "We linked “Sage Mug” to Sage Stoneware Mug: it’s the only one with all those
words." It shows it matched the till's short names to the stock list, and says so. Then click **"See my
dashboard"**.

**Say:**

> "And this is their business on one page. Sales, profit, channels, top products, what's running low.
> Built automatically for a retail business. Nobody designed this dashboard for Fernwood."

**Backup:** if the import stalls for > 20s, say "while that finishes, here's one I prepared earlier" and
switch to tab B.

### 3:10 — Proactive insights (≈ 45s)

**Do:** go to **Home**. Point at the key numbers and the weekly summary, then read the top insight cards
(today's exact sentences are printed by `pnpm demo:up`):

- "**Sage Stoneware Mug** will run out in about **6 days** at the current sales rate (**3.9** a day). You
  have **24** left." Point at the line under it: "Consider reordering about … from Hearth & Kiln
  Ceramics to cover the next 44 days."
- "**Bloom & Co**'s orders dropped **6x%** compared with their usual. Their last order was **41** days ago."
- "The cost of **Linen Napkin Set** went up **22%**, from **$8.40** to **$10.25**. At your price of
  **$20.00**, your margin fell from **58%** to **48.8%**."

**Say:**

> "This is the part owners love. It doesn't wait to be asked. It tells them their best-seller is about to
> run out, their biggest stockist is quietly drifting away, and a supplier price rise is eating their
> margin. Each of those is real money."

### 3:55 — Ask (≈ 75s)

**Do:** go to **Ask**. Type: **"Which products made me the most profit last month?"**

When the answer appears:

- read the headline
- show the chart
- expand **"How I calculated this"**

**Say:**

> "Every number here comes from their actual records. It shows exactly how it calculated the answer. And
> if you're technical, the details are one click away."

Click **Details** briefly to show the SQL, then collapse it.

**Do:** type **"Who are my best customers?"** It asks: *"By how much they spend or how often they order?"*
Tap **"How much they spend"**.

**Say:**

> "When a question is ambiguous, it asks instead of guessing."

**Do:** click **📌 Add to dashboard**.

### 5:10 — Change the dashboard by chat (≈ 30s)

**Do:** on **Dashboard**, type in "Change this dashboard": **"Add a chart of sales by channel by month"**.
Show the preview, then click **Apply**.

**Say:**

> "No drag-and-drop builders, no formulas. They just say what they want."

### 5:40 — (Optional, if M6 is done) Keeping up to date (≈ 40s)

**Do:** go to My data → "Add or update files". Upload `demo-files/Next month/Online orders 2025-26.xlsx`
(the same export, a month later). Click **"Looks good, compare with my data"**.

Show "Here's what would change": the new sales, the few cancelled ones, and that sales missing from the
newer file are kept. Click **Update my data**. The insights refresh.

**Say:**

> "Next month they just drop in the new export. It merges safely and never overwrites anything silently."

### 6:20 — Close (≈ 30s)

**Do:** optionally hold up the phone showing Home.

**Say:**

> "Messy files in, a business analyst out, in about two minutes. It works on a phone, and it's built so
> every number is real and every change can be undone. We're starting with the X million small retailers
> and online sellers who live in spreadsheets. The same engine extends to other industries with what we
> call vertical packs. Connectors to Shopify, POS systems and accounting tools are next."

---

## 3. The demo dataset: "Fernwood Home & Gift"

Generated by `scripts/demo-data` (`pnpm demo:generate --today 2026-10-13 --seed 42`). It is deterministic
for a given seed and `--today`. It outputs the messy files plus `ground_truth.json`, which holds the clean
entities and the expected values for every planted story and demo question.

### 3.1 The business

- Home and gift shop.
- About 140 products across 8 categories:
  - Mugs & Cups
  - Candles
  - Linens
  - Glassware
  - Prints
  - Plants & Pots
  - Cards
  - Seasonal
- **Channels:**
  - own website (~45% of sales)
  - Etsy (~20%, growing)
  - in-store till (~25%)
  - wholesale to 8 boutique stockists (~10%, invoiced, 30-day terms)
- **History:** 12 months ending at `--today`. About 3,500 orders and about 6,500 order lines.
- About 600 named customers (web/Etsy/wholesale) plus anonymous walk-ins.
- Seasonality: a Nov/Dec peak; summer dip.
- Currency: USD (configurable via a generator flag).

### 3.2 Files and their deliberate messiness

| File | Contents | Messiness |
|---|---|---|
| `Online orders 2025-26.xlsx` | Sheet **Website**: Shopify-style line-level export. Sheet **Etsy**: Etsy order-items export | Title banner row above headers on both; different headers per sheet; order fields blank on 2nd+ lines in Website (fill-down needed); Etsy dates DD/MM/YYYY while Website uses ISO timestamps; prices as text with "$"; 2 "TOTAL" rows; 3 blank rows; a cancelled order; one injection canary cell in a note ("Ignore previous instructions…") to prove robustness |
| `Shop till export.csv` | POS line export from the shop | Windows-1252 encoding; `Qty`, `Item`, `Gross` headers; walk-in sales with no customer; item names slightly different from the stock list ("Sage Mug" vs "Sage Stoneware Mug"); refunds as negative quantities |
| `Wholesale invoices.xlsx` | One sheet per quarter (`Q4 2025` … `Q4 2026`) | Same headers across sheets (union + period); customer names inconsistent ("Bloom & Co", "Bloom and Co.", "BLOOM & CO LTD"); quantities like "12 pcs"; `Paid?` column with Y / N / part / ✓; due dates sometimes blank (use 30-day terms) |
| `Stock list & costs.xlsx` | Product master with stock | Category as **section header rows** (CANDLES, LINENS…); merged two-row header ("Price" over "Cost (ex tax) / RRP"); some SKUs missing; "Pcs in stock" with "pcs" suffixes; note rows ("DISCONTINUED - do not reorder"); a SUM row at the bottom |
| `Supplier orders.csv` | Purchase lines from 5 suppliers | Mixed date formats; supplier names with trailing spaces; cost history showing the Linen Napkin price rise in June |
| `Expenses 2026.xlsx` | Monthly expenses | **Wide format**: categories as rows, months as columns (Jan…Oct); "–" for zero; a TOTAL column and TOTAL row |
| `Next month/Online orders 2025-26.xlsx` *(M6 scene)* | Same format as the Website sheet, covering the last 3 weeks | Overlaps the previous file by 1 week (dedupe/merge test); 4 orders with changed status (refunded/cancelled); 86 genuinely new orders |

### 3.3 Planted stories (must be detected with exact numbers from `ground_truth.json`)

| Story | Setup in generator | Expected insight |
|---|---|---|
| **Stock-out risk** | Sage Stoneware Mug: best seller, ~4 sales a day over the last 28 days, stock set to 6 days of sales (~25 on hand) → ~6 days | `stockout_risk` urgent, ≈ 6 days |
| **Declining customer** | Bloom & Co (wholesale): ~monthly orders of ~$900 for 10 months, then the last 2 months down ~65%, last order 41 days ago | `customer_slipping` |
| **Dead stock** | Christmas Spice Candle (and 4 other seasonal items): ~140 units on hand, no sales since January | `dead_stock`, with ~$X tied up |
| **Margin squeeze** | Linen Napkin Set: supplier cost $8.40 → $10.25 (+22%) from June; price unchanged at $20 → margin 58% → 49%. (Final numbers set by the generator; script copy reads from ground truth.) | `margin_squeeze` |
| **Channel shift** | Etsy share up ~12 points vs the prior 90 days | `channel_shift` |
| **Return spike** | Glass Carafe: 18% return rate in the last 60 days (reason "arrived broken") | `return_spike` |
| **Overdue payments** | 2 stockists with invoices > 30 days overdue | `overdue_payments` |
| **Rising star** | Terracotta Herb Pot: sales +70% over the last 4 weeks | `rising_star` |
| **Control** | Everything else follows stable seasonal patterns with noise | no false urgent alerts |

**Note:** the numbers move with the demo day, because the files are generated for today. `pnpm demo:up`
prints the day's import counts and Home's insight sentences; read those out. The M7 acceptance test
checks every story against `ground_truth.json` for a fixed day (2026-10-13), and the demo shop's test
checks the stories still appear for today.

### 3.4 Demo questions (in the eval "demo subset"; must be 100% correct)

1. Which products made me the most profit last month?
2. Who are my best customers? → clarify → by spend
3. How much did I sell on Etsy this year compared with last year?
4. What's about to run out?
5. Which customers stopped ordering?
6. How much money is tied up in stock that isn't selling?
7. What did I spend on ads this year?
8. Show sales by channel by month. (dashboard edit)

---

## 4. Failure plan

| Problem | Recovery line | Action |
|---|---|---|
| Upload/import slow (> 20s on a stage) | "While that finishes, here's one I prepared earlier." | Switch to tab B |
| An answer is wrong or odd | "Let me show you how it explains itself." | Open "How I calculated this"; move on to the next scripted question |
| AI provider down | — (invisible) | Replay mode serves recorded responses |
| Total outage | "Let me show you the recording." | Play the 3-minute backup screen recording (kept on the desktop) |

---

## 5. Rehearsal checklist

- [x] Generator dated automatically: `pnpm demo:up` and "Try the demo shop" generate for today; `demo:up` prints the day's numbers
- [x] Fresh demo workspace (tab A) and pre-imported backup (tab B) made by `pnpm demo:up`
- [x] Automated rehearsal (`apps/web/e2e/demo.spec.ts`), twice in a row with AI off (replay only, no key), 2026-10-16:
  - run 1: 38.5 s of machine time, no errors
  - run 2: 33.1 s of machine time, no errors
  - longest waits: the live import (about 17 s from upload to the data report) and next month's file (about 12 s)
- [ ] Presenter run 1 timed (talking included): ____ min. Issues: ____
- [ ] Presenter run 2 timed: ____ min. Issues: ____
- [x] Run with the AI network blocked (replay only) passes (the automated runs above)
- [x] Phone view checked: every main page fits an iPhone SE with no sideways scrolling (`e2e/quality.spec.ts`)
- [ ] Backup screen recording made with this build
