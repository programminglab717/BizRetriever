# Product Spec

**Audience:** non-technical owners and managers of small retail and ecommerce businesses. They sell
through their own website, marketplaces, social channels, a physical shop, or several of these. Some also
sell wholesale.

**Promise:** *"Upload your messy spreadsheets. Get answers, a dashboard, and warnings about your business,
in minutes, with no setup."*

---

## 1. Design principles

1. **Outcome first.** Every screen answers "what's going on in my business?" The data plumbing is only
   visible if you go looking for it.
2. **Plain language.** Write for a busy shop owner on a phone. Short sentences. Their words, not ours.
3. **Show your work.** Every number can be traced: "How I calculated this", then "Where this came from"
   (file, sheet, row).
4. **Nothing happens behind your back.** We never delete or overwrite data without asking. Every change can
   be undone.
5. **Honest about guesses.** When we assume something, we say so, and offer a one-tap fix.
6. **Mobile-first** for Home, Ask, Dashboard and Insights. Onboarding review is designed for desktop but
   works on a phone.

---

## 2. Copy guidelines

**Voice:** friendly, direct, confident, never cute. Use second person ("your sales"). We are a helpful
analyst, not a robot.

**Rules:**

- Sentences ≤ 20 words where possible. Reading-ease target: Flesch ≥ 60.
- Lead with the answer, then the detail.
- Numbers are formatted for the workspace locale: currency symbol, thousands separators, at most 1 decimal
  for percentages, whole numbers for counts.
- Dates are relative when recent ("last Tuesday"), otherwise "4 Mar 2026" style (order by locale).
- Never blame the user. "We couldn't read this date" is right; "Invalid date format" is wrong.
- Every error says what happened, why (if known), and what to do next.

**Banned words in primary flows, and what to use instead.** The automated copy linter (M8) checks UI
strings and AI outputs.

| Don't say | Say |
|---|---|
| schema, table, database | your data, your records |
| row | record (or the thing: "sale", "product") |
| column, field | detail, information (or "price", "date") |
| query, SQL | question, calculation |
| join, foreign key, relationship | link ("sales are linked to customers") |
| null, NaN, undefined | blank, missing |
| ingest, ETL, pipeline | bring in, import |
| dedupe | merge duplicates |
| parse error | couldn't read |
| metric | measure (or just the name: "profit") |
| aggregate | total, average |
| migration | change |
| entity | type of record (or the plural: "products") |

**Advanced/Details views** (collapsed by default, labelled "Details") may use technical terms: SQL text,
field types, internal names.

---

## 3. Navigation and information architecture

- **Desktop:** left sidebar. **Mobile:** bottom tab bar with 4 tabs plus "More".

| Nav item | Mobile | Purpose |
|---|---|---|
| **Home** | tab | Insights feed + key numbers + "Ask anything" box |
| **Ask** | tab | Conversation with the analyst |
| **Dashboard** | tab | Auto-generated, editable dashboard |
| **My data** | tab | Records browser (products, sales, customers…) + "Add or update files" |
| More → What we track | menu | Business glossary (measures + definitions) |
| More → Change history | menu | Structural changes, merges, undo |
| More → Settings | menu | Business details, currency, dates, alerts, members |

- **Global header:** workspace name and a date range picker. The picker shows on Dashboard and Home and
  applies across the dashboard.

---

## 4. Journeys and screens

Each screen below lists its states:

- **Default**
- **Loading**
- **Empty**
- **Error**
- **Edge**

### Journey 1 — Onboarding and first upload

#### 1.1 Sign up / sign in

- **Default:**
  - email + password, or "Continue with Google"
  - one-line value proposition
  - link to "Try the demo shop"
- **Errors:**
  - "That email already has an account. Sign in instead?"
  - "Password needs at least 10 characters."
  - Google failure: "Google sign-in didn't work. Try again or use email."
- **Email verification:** required before inviting members, but not before uploading. This keeps the time
  to "wow" short.

#### 1.2 Tell us about your business (single screen)

- **Fields:**
  - business name
  - "What do you sell and how?", a card picker:
    - **Shop or online store selling products** (retail pack)
    - other industries greyed out with "Coming soon. Tell us what you do"
  - currency (prefilled from browser locale)
  - "How do you write dates?" with a live example: `03/04/2026` = **3 April** or **March 4**
  - timezone (auto-detected, editable under "More options")
- **CTA:** "Continue".
- **Copy:** "This helps us read your files correctly. You can change it later."

#### 1.3 Upload your files

- **Default:**
  - large drop zone: "Drop your spreadsheets here: sales, stock lists, supplier orders, expenses. Excel or
    CSV. Messy is fine."
  - "Choose files" button (on mobile, opens the file picker)
  - checklist of helpful files with examples
  - "Don't have files handy? Explore the demo shop."
- **Uploading:** a progress bar per file. Remove a file with ×.
- **Validation errors (per file, others continue):**
  - "This file is bigger than 25 MB. Try splitting it by year."
  - "We can't open PDF files yet. Export to Excel or CSV."
  - "This file is password-protected. Remove the password and try again."
  - "This file looks empty."
- **CTA:** "Make sense of my data". Enabled once ≥ 1 file has uploaded.

#### 1.4 Working on it (processing)

- **Progress stages** in plain language, each ticking when done:
  1. "Opening your files"
  2. "Finding the real data (skipping titles, totals and blank lines)"
  3. "Working out what each column means"
  4. "Checking how everything links together"
  5. "Doing a test run"
- Typical time is 30–90s. Show a live "What we've spotted so far" teaser. For example: "Found a sheet that
  looks like Etsy orders." These lines come from deterministic detectors.
- **Can leave:** "We'll keep going. You can close this page." Progress persists, and the user returns to
  the review screen.
- **Error:** "Something went wrong reading *Sales 2026.xlsx*. Your file is safe. [Try again] [Skip this
  file] [Get help]". Internal details are logged, never shown.

#### 1.5 Here's what we found (proposal review) — the key screen

**Layout:**

- **Top summary card.** AI-phrased, every number filled in by code. Example:

  > "We found **412 products**, **1,280 sales** across **3 channels**, and **96 customers**. We'll skip
  > **14 rows** that look like totals or notes. **3 things** need a quick look."

- **"Needs a quick look" list.** At most 3 questions plus low-confidence assumptions. Each is a card with
  one-tap answers:
  - "Are *Bloom & Co*, *Bloom and Co.* and *BLOOM & CO LTD* the same customer?" → [Same] [Different]
    [Let me choose]
  - "Does *Cost* in *Stock list* mean the cost **per item**?" → [Yes, per item] [No, total]
  - "The dates in *Etsy* look like day/month (e.g. 25/03/2026). Is that right?" → [Yes] [No]
- **"What we'll bring in."** One card per record type (Products, Sales, Customers, Supplier orders,
  Expenses). Each shows:
  - count
  - which files and sheets it comes from
  - 3 example records rendered as friendly cards, not a grid
  - "Show details" expands into a mapping list: "*Qty* → Quantity · *Cust Name* → Customer". Each line has
    an edit menu: "This is actually…" (searchable list of details), "Don't bring this in".
- **"What we'll skip."** Grouped reasons with counts: totals rows, blank rows, notes, duplicate records.
  Expandable to see the exact rows.
- **"Things we assumed."** A list, each with "Change".
- **Chat box:** "Anything look wrong? Tell me in your own words." Example: "the Etsy sheet prices include
  shipping". Corrections re-run the test and update the screen with a highlighted "What changed" list.

**CTAs:**

- **Primary:** "Looks good, set it up". Disabled until required questions are answered. Optional ones can
  be skipped, and the default is then stated.
- **Secondary:** "Start over with different files".

**Edge cases:**

- **Nothing recognised:** "We couldn't match these files to a shop's usual records. Is this sales,
  stock or something else?" Offer quick picks, and offer to create custom record types.
- **Only one type found** (e.g. only a product list): proceed, and list what data would unlock more
  (sales → trends, costs → profit).

#### 1.6 Setting things up

- **Progress stages:**
  1. "Creating your records"
  2. "Bringing in 1,280 sales…" (with a counter)
  3. "Building your dashboard"
  4. "Looking for things you should know"

#### 1.7 Your data report (data quality report)

A short, celebratory but honest summary:

- ✅ "1,280 sales, 412 products, 96 customers brought in"
- ⏭ "14 rows skipped (12 totals, 2 notes)" → view
- ⚠ "6 sales mention a product we couldn't find in your stock list. We kept them and marked the product as
  *Unknown*." → [Fix these]
- 💡 "Assumptions we made" (list, each changeable)
- **CTA:** "See my dashboard". The report is always available later from My data → "Last import".

**Acceptance (Journey 1):** the demo dataset goes from first upload to dashboard in **≤ 2 minutes of user
time** (excluding typing the business name), with **≤ 3 questions** answered.

### Journey 2 — Ask a question

#### 2.1 Ask screen

- **Empty state:**
  - "Ask me anything about your business."
  - 6 suggestion chips from the pack's example questions, filtered to what's answerable
  - plus "What can I ask?"
- **Input:** a single-line box that grows, with a send button. On mobile, it sticks above the keyboard.
- **Thinking state:** "Working it out…" with a skeleton chart. After 4s: "Still working: checking 1,280
  sales." Uses real counts.

**Answer card:**

1. **Headline answer.** 1–3 sentences with key numbers in bold. Example: "Your most profitable product
   last month was **Sage Stoneware Mug**, making **$1,240** in gross profit."
2. **Chart or table** (deterministic choice). Tap a point for details. "Show as table" toggle.
3. **Assumption line** (if any), in muted text with an inline fix: "I took *profit* to mean sales minus
   product costs. [Use a different meaning]"
4. **"How I calculated this"** (collapsed). Contains:
   - plain steps: "Added up sales after discounts for each product in March 2026, then subtracted what
     those items cost you."
   - date range, filters, and definitions of the measures used
   - "Details", which shows the SQL and the record count scanned
5. **Actions:**
   - 📌 "Add to dashboard"
   - 👍 / 👎 (👎 asks "What was wrong?" with quick reasons)
   - "Ask a follow-up"

**Other answer types:**

- **Clarifying question:** "Do you mean your best customers by **how much they spend** or **how often they
  order**?" with option buttons. The choice can be remembered with "Remember this".
- **Can't answer, missing data:** "I can't work out profit yet because I don't have your product costs.
  [Add a file with costs]"
- **Can't answer, unclear or out of scope:** "I'm not sure how to answer that from your data. Try: *…*"
  with 2 rephrasings.
- **Large result:** "Showing the top 15 of 212. [See all]", which opens the full table with an export
  option.
- **Error/timeout:** "That one took too long. Try a shorter date range, or ask about fewer things at once."

#### 2.2 Pin to dashboard

Pinning adds the tile at the top of the dashboard and shows a toast: "Added to your dashboard. [View]
[Undo]". Pinned tiles follow the global date range unless the question had a fixed date ("March 2026"). In
that case the tile shows a 📅 badge, and the user can choose "Follow dashboard dates".

### Journey 3 — Dashboard

- **Default:** the pack's dashboard (VERTICAL_PACKS §2.6), with tiles hidden where data is missing.
- **"Unlock more" card:** "Add product costs to see profit and margins."
- **Date range picker:**
  - presets: Last 7 days, Last 30 days, This month, Last month, This quarter, This year, Custom
  - comparison toggle: "Compare with previous period"
  - applies to all tiles except fixed-date ones
- **Edit by chat:** a "Change this dashboard" box (on mobile, a floating button). Examples: "add a chart
  of sales by city", "remove the returns chart", "show sales monthly instead of weekly". Shows a **preview**
  of the change with [Apply] [Cancel]. After applying, a toast with Undo appears.
- **Edit by hand:**
  - "Edit layout" mode: drag to reorder, resize with corner handles (desktop), ⋮ menu per tile (rename,
    change chart, remove, "Ask about this")
  - on mobile: reorder only
- **Tile states:**
  - loading skeleton
  - "No sales in this period"
  - error: "Couldn't load this. [Retry]"
  - stale-data note when data hasn't been updated in more than 14 days
- **Live data:** tiles re-query on load and after any data change. Results are cached per (tile, date
  range, data version).

### Journey 4 — Keep data up to date

#### 4.1 Add or update files

- **Entry points:**
  - My data → "Add or update files"
  - a Home prompt: "Your sales are up to 4 Oct. Upload newer files?"
- **Matching:** after upload, we match the file to a known source: "This looks like a newer version of
  **Online orders**. [Yes, update it] [No, it's new data]"
- **Change preview** (diff):
  - "**86 new sales**, **4 changed** (e.g. *Order 1043: status Pending → Refunded*), **1,190 unchanged**."
  - "**12 sales are in your old file but not this one.** We'll keep them. [Review]"
  - **Conflicts:** "*Customer Bloom & Co*: you edited their email here, but the file has a different one.
    Keep [yours] or [the file's]?"
- **CTA:** "Update my data". Afterwards: a summary toast, a Change history entry with [Undo this update],
  and a fresh insight run.

#### 4.2 Browse and edit records (My data)

- **Record-type list:** cards with counts (Products 412, Sales 1,280…).
- **Spreadsheet-like grid:**
  - virtualised; sticky first column
  - search and simple filters (chips)
  - sort by clicking headers
  - human column names
  - linked records shown as chips (tap to open)
- **Edit:** click a cell to edit inline, with type-aware inputs (date picker, number, dropdown for allowed
  values, linked-record search). Enter saves; Esc cancels. A toast with Undo follows. Validation is inline:
  "Quantity must be a number."
- **Record side panel:**
  - all details
  - linked records (a customer's sales)
  - "Where this came from" (file, sheet, row)
  - history of edits
- **Delete:** a confirmation dialog, then soft delete. The record can be restored from "Recently deleted"
  for 30 days.
- **Mobile:** a card list instead of the grid, with tap-to-edit.

#### 4.3 Add or change records by chat

- **Prompt:** "Add a sale: 5 Sage mugs to Bloom & Co today".
- **Confirmation card** (rendered by code from the validated plan):

  > **New sale** · Today (13 Oct 2026) · Customer **Bloom & Co** · 5 × **Sage Stoneware Mug** at **$18.00**
  > (their usual price) = **$90.00**
  > ⚠ I used the product's normal price. [Change]

  Buttons: [Add it] [Edit] [Cancel]
- **Ambiguous product or customer:** "Which mug did you mean?" with candidates.
- **New customer:** shown explicitly: "**New customer** *Bloom & Co Ltd* will be created."

### Journey 5 — Insights

- **Home feed:**
  - up to 5 insight cards sorted by importance
  - each card has an icon (stock/customers/profit/cash/trend), a headline (numbers bold), and one line of
    context
  - a primary action ("See product", "Reorder list", "View customer") and a ⋮ menu (Dismiss, Not useful,
    Change alert settings)
- **All insights:** a list with filters by category. Dismissed insights are hidden.
- **Empty state:** "Nothing needs your attention right now. 🎉 We check every time your data changes."
- **Not enough history:** "We need about 4 weeks of sales to spot trends. We'll start as soon as we can."
- **Weekly digest (in-app):** a Monday card on Home. It contains:
  - this week vs last
  - top 3 new insights
  - one suggested question

  Email comes later.
- **Alert settings:** each rule has a toggle and a threshold in plain words ("Warn me when stock will run
  out within **14** days").

### Journey 6 — Change how data is organised (by chat)

- **Entry:**
  - Ask or My data → "Change what you track"
  - the AI detects structural intent in Ask and offers: "Want me to start tracking salespeople?"
- **Change plan card:**
  - what will change: "Add a **Salesperson** detail to every sale. Existing sales will have it blank. You
    can fill it in from a file or by hand."
  - impact, generated by code: "Affects 1,280 sales. No measures or dashboard charts change."
  - for destructive changes, a red notice: "This will remove *Gift wrap* from 1,280 sales. We'll keep a
    backup for 30 days so you can undo." The user must type the name to confirm.
- **Buttons:** [Make this change] [Cancel].
- **After:** a toast and a Change history entry.
- **Change history:**
  - a timeline of changes (structural, file updates, bulk edits)
  - each entry has: who, when, what (plain language), and [Undo]
  - if undoing would lose data entered since, a dialog explains exactly what will happen

### Settings

- business name; industry (read-only in the MVP)
- currency; date order; timezone; fiscal year start
- alert settings
- members: invite by email (owner only), designed in M1 and wired in M6+
- "Hide personal details from AI": on by default
- export all my data (CSV zip) — M8 nice-to-have
- delete workspace: typed confirmation

---

## 5. Global states and patterns

| Pattern | Spec |
|---|---|
| Loading | Skeletons shaped like the content. Text progress for anything > 2s; real progress stages for jobs. |
| Toasts | Bottom-centre on mobile, bottom-right on desktop. Always include Undo for reversible actions. |
| Confirmations | Only for writes, destructive actions and bulk changes. Dialog copy states consequences in concrete numbers. |
| Offline | "You're offline. Changes will be saved when you reconnect" (read-only mode). |
| Session expired | Re-auth modal that preserves the current screen. |
| Permissions | Members can do everything except billing (later), deleting the workspace, and inviting. |
| Accessibility | WCAG 2.2 AA: keyboard navigation, focus rings, 4.5:1 contrast, charts with table alternatives and aria labels, 44px touch targets. |
| Performance | Home ≤ 2s LCP on 4G with the demo dataset. Answers ≤ 6s p95. Dashboard tiles ≤ 1.5s each p95. |

---

## 6. Demo workspace

- "Try the demo shop" creates (or resets) a workspace preloaded with the **Fernwood Home & Gift** dataset
  (see DEMO_SCRIPT), already imported, with insights generated.
- **Banner:** "You're exploring a demo shop. [Use my own data]".
- Demo workspaces are marked `is_demo`, may use AI replay (ADR-021), and are deleted after 7 days of
  inactivity.

---

## 7. Out of scope for the MVP (see PLAN roadmap)

- Connectors (Shopify, Google Sheets, POS, accounting)
- Email digests and alerts
- WhatsApp
- Multilingual UI
- Multi-currency
- Granular roles
- Billing
- Public API / MCP server
- Additional packs
- Forecasting beyond simple run-rate maths
