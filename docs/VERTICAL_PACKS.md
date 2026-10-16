# Vertical Packs

A **Vertical Pack** is a versioned, declarative bundle of industry knowledge. The core engine has no
industry-specific code. Everything that makes BizRetriever feel tailor-made for an industry lives here.

Packs live in `packages/packs/packs/<pack-id>/`. Each pack is validated against a Zod schema at build time
(`pnpm packs:validate`, part of CI). A workspace stores the `pack_id` and `pack_version` it was created
with. Pack upgrades are opt-in per workspace and are applied as change plans.

---

## Part 1 — Pack format specification (v1)

### 1.1 Directory layout

```
packages/packs/packs/retail/
  pack.yaml                 # manifest
  entities.yaml             # canonical entities, fields, relationships, natural keys
  synonyms.yaml             # column-name synonyms and value synonyms
  patterns.yaml             # messy-data patterns and known export formats
  metrics.yaml              # business metrics (metric IR)
  dashboard.yaml            # default dashboard layout
  insights.yaml             # insight / alert rules
  questions.yaml            # example questions shown to users
  prompts/                  # optional prompt fragments (plain text, versioned)
    domain_primer.md        # short industry primer injected into AI system prompts
  fixtures/                 # small sample files used by pack tests
```

### 1.2 `pack.yaml` (manifest)

```yaml
id: retail                    # stable id, [a-z0-9_]+
version: 1.0.0                # semver; MAJOR = breaking entity/metric changes
name: Retail & Ecommerce
description: For shops and online stores that sell physical products.
industries_label: "Shop, online store or both"   # shown in the industry picker
locale_defaults: { currency: USD, date_order: MDY }
requires_core: ">=0.1.0"      # minimum engine version
primary_time_entity: sale      # default time axis for dashboards
```

### 1.3 `entities.yaml`

Each entity has:

- `id`
- `label` (singular, plural)
- `description` (plain language)
- `required` (whether the pack expects it; most are optional)
- `natural_key` (fields used to match records across uploads)
- `fields`

Each field has:

- `id`
- `label`
- `type`: `text` | `integer` | `decimal` | `money` | `percent` | `date` | `datetime` | `boolean`
- `semantic`: `name` | `identifier` | `email` | `phone` | `city` | `region` | `country` | `postal_code` |
  `category` | `quantity` | `unit_price` | `unit_cost` | `amount` | `status` | `channel` | `note`
- `required`
- `pii`
- `allowed_values` (optional)
- `description`

Relationships are declared on the child entity as `references: { entity, via: [fields], cardinality }`.
Physical tables and columns are derived from ids by the engine. Users never see them.

### 1.4 `synonyms.yaml`

```yaml
fields:
  sale_line.quantity: [qty, quantity, pcs, units, "no. of items", "lineitem quantity", count, "qty sold"]
values:
  sale.channel:
    online_store: [website, web, shopify, "online store", woocommerce]
    marketplace_etsy: [etsy]
    in_store: [shop, till, pos, "in store", counter, walk-in]
```

Synonyms are hints, not hard rules. The AI combines them with profiles and context.

### 1.5 `patterns.yaml`

These are messy-data patterns the profiler and AI should recognise. Each pattern has an id, a description,
detection hints, and the cleaning rules it typically implies (from the core cleaning-rule vocabulary in
`docs/AI_DESIGN.md` §3.3).

It also declares **known export formats**: header signatures for common systems, each mapped directly to
entities. This gives high-confidence mappings with no AI guesswork.

### 1.6 `metrics.yaml`

Metrics are written in the **metric IR**. The IR is not SQL: the compiler turns it into SQL against each
workspace's actual tables.

```yaml
- id: net_sales
  label: Net sales
  description: Money from sales after discounts and refunds, before costs. Excludes tax and shipping charged.
  format: money
  ir:
    sub:
      - { sum: { field: sale_line.line_total } }
      - { sum: { field: return.refund_amount }, coalesce: 0 }
  time_field: sale.sale_date
  requires: [sale_line.line_total]
  good_direction: up
```

IR operators:

- Aggregates: `sum`, `count`, `count_distinct`, `avg`, `min`, `max`
- Arithmetic: `add`, `sub`, `mul`, `div` (safe divide → null on zero)
- `coalesce`
- `filter` (field op value)
- `ref` (another metric)
- `window`: last N days, previous period. Only valid in insight rules and comparisons.

Each metric declares:

- `requires`: fields that must exist, otherwise the metric is marked unavailable with a reason
- `time_field`
- `format`: `money` | `number` | `percent` | `days`
- `good_direction`
- optional `unavailable_hint` (plain-language call to action)

### 1.7 `dashboard.yaml`

An ordered list of tiles. Each tile has:

- `title`
- `query`: a query spec using metric ids and dimension field ids
- `chart`: optional preference
- `layout`: `{w, h}` on a 12-column grid, with mobile ordering
- `requires`: metrics

Tiles whose metrics are unavailable are replaced by a single "Unlock more" card listing what data to add.

### 1.8 `insights.yaml`

Each rule has:

- `id`
- `label`
- `description`
- `category`: `stock` | `customers` | `products` | `profit` | `cash` | `trends`
- `severity_formula`
- `defaults`: thresholds, which users can edit in alert settings
- `requires`: fields/metrics
- `detect`: the detection query. Written in the query spec plus `having`/window extensions, or as a
  **parameterised SQL template over canonical field placeholders** (`{{t:sale_line}}`,
  `{{f:product.name}}`). The engine resolves the placeholders against the workspace catalog and validates
  the result with the SQL validator. Templates are pack-authored (trusted, reviewed code), never
  AI-authored.
- `facts`: named values the detection produces
- `template`: deterministic text with `{{fact}}` placeholders. The AI may rephrase it, but the numbers stay
  placeholders.
- `action_hint`: an optional suggested next step
- `cooldown_days`: don't repeat an unchanged alert within this window

### 1.9 `questions.yaml`

Example questions, grouped by category, shown as suggestion chips. Each has `requires`, so we only show
questions the workspace can answer. Each optionally has an `expected_spec`, used by evals.

### 1.10 Versioning and compatibility rules

- **PATCH:** synonyms, copy, example questions, prompt wording.
- **MINOR:** new optional entities/fields/metrics/rules/tiles.
- **MAJOR:** renaming or removing entities, fields or metrics, or changing a metric's meaning. Requires a
  migration note and a per-workspace upgrade change plan.
- A pack must pass `pnpm packs:validate`, which checks:
  - the schema
  - all references resolve
  - every metric's `requires` exists
  - every dashboard tile and insight rule compiles against the pack's own canonical model
  - all `fixtures/` load

### 1.11 Adding a new pack (no core code changes)

1. Copy `packs/_template/`.
2. Write the YAML files.
3. Add fixtures.
4. Run `pnpm packs:validate` and `pnpm eval --pack <id>`.
5. Register the pack in `packages/packs/index.ts`. This is the only code change: a one-line import list.

---

## Part 2 — The `retail` pack (v1.0.0): Retail & Ecommerce

**Who it's for.** Shops and online stores that sell physical products, through:

- their own website
- marketplaces (Etsy, Amazon, eBay)
- social commerce
- a physical shop or market stall

Some also sell wholesale to other shops.

**Typical data:**

- order exports (often one row per item, with order details repeated)
- POS till exports
- a hand-kept product/stock list with costs
- supplier orders
- an expenses sheet
- for wholesale sellers, an invoice/payments sheet

### 2.1 Entities

| id | Label (singular / plural) | Natural key | Key fields | Notes |
|---|---|---|---|---|
| `product` | Product / Products | `sku`, else normalised `name` + `variant` | sku, name, variant, category, brand, unit_price (selling price), unit_cost, supplier_ref, reorder_point, is_active, barcode | Section-header rows in stock lists often carry `category` |
| `customer` | Customer / Customers | email, else normalised name (+ city) | name, email (pii), phone (pii), city, region, country, postal_code, customer_type (`retail`/`wholesale`), payment_terms_days | Walk-in POS sales may have no customer |
| `supplier` | Supplier / Suppliers | normalised name | name, contact_name, email (pii), phone (pii), lead_time_days | |
| `location` | Sales place / Sales places | name | name, type (`online`/`shop`/`warehouse`/`market`) | Optional; single-location businesses skip it |
| `sale` | Sale / Sales (UI: "orders") | order_number + channel | order_number, sale_date, customer_ref, channel, location_ref, status (`completed`/`cancelled`/`refunded`/`pending`), discount_total, shipping_charged, tax_total, total, payment_status (`paid`/`unpaid`/`partial`), due_date | Header-level; built by splitting line-level exports |
| `sale_line` | Sale item / Sale items | sale natural key + line position (or product ref) | sale_ref, product_ref, product_name_raw, quantity, unit_price, discount, line_total, unit_cost_at_sale | `line_total` derived as qty × price − discount when missing |
| `return` | Return / Returns | sale ref + product ref + date | sale_ref, product_ref, return_date, quantity, refund_amount, reason | |
| `purchase` | Supplier order / Supplier orders | po_number, else supplier + date | po_number, supplier_ref, order_date, received_date, status, total, shipping_cost | |
| `purchase_line` | Supplier order item / items | purchase key + product ref | purchase_ref, product_ref, quantity, unit_cost, line_total | Source of cost history (margin squeeze) |
| `stock_count` | Stock level / Stock levels | product ref + location ref + counted_at | product_ref, location_ref, counted_at, quantity_on_hand | A "Pcs in stock" column on a product list becomes a stock_count dated at upload time |
| `stock_movement` | Stock change / Stock changes | — (row hash) | product_ref, moved_at, quantity_change, reason (`sale`/`purchase`/`adjustment`/`damage`/`return`) | Optional; few small businesses track it |
| `expense` | Expense / Expenses | date + category + amount + description (hash) | expense_date, category, description, amount, vendor, payment_method | Wide month-column sheets are unpivoted |
| `payment` | Payment received / Payments received | reference, else hash | received_date, customer_ref, sale_ref, amount, method | Mostly for wholesale invoices |

**Relationships:**

- `sale_line` → `sale` (many-to-one)
- `sale_line` → `product`
- `sale` → `customer`
- `sale` → `location`
- `return` → `sale`, `product`
- `purchase` → `supplier`
- `purchase_line` → `purchase`, `product`
- `stock_count` → `product`, `location`
- `stock_movement` → `product`
- `payment` → `customer`, `sale`
- `product` → `supplier` (preferred supplier)

**Preferred join paths:** product ↔ customer goes through `sale_line → sale`.

**Stock on hand.** Computed as the latest `stock_count` per product (and location), plus or minus movements
after the count when `stock_movement` exists. Otherwise it's latest count − units sold since the count +
units received since the count. The method used is shown in "How I calculated this".

### 2.2 Column synonyms (excerpt; the full list lives in `synonyms.yaml`)

| Canonical field | Recognised headers (case/space/punctuation-insensitive) |
|---|---|
| product.sku | sku, item code, product code, code, ref, style no, lineitem sku, variant sku, barcode* (*only if no other id) |
| product.name | product, item, item name, description, product title, title, lineitem name, listing |
| product.category | category, type, product type, department, dept, collection, section |
| product.unit_price | price, rrp, retail price, sell price, selling price, unit price, srp |
| product.unit_cost | cost, unit cost, cost price, buy price, wholesale cost, cogs, landed cost, cost (ex vat), cost ex tax |
| sale.order_number | order, order #, order no, order id, name (Shopify), receipt no, receipt #, invoice no, transaction id |
| sale.sale_date | date, order date, created at, sale date, paid at, transaction date, invoice date, day |
| sale.channel | channel, source, sales channel, platform, store, marketplace |
| sale_line.quantity | qty, quantity, pcs, units, no. of items, lineitem quantity, count, qty sold |
| sale_line.unit_price | price, unit price, lineitem price, each, rate, item price |
| sale_line.line_total | total, line total, amount, gross, net, value, subtotal (line-level only) |
| customer.name | customer, cust name, customer name, buyer, billing name, client, account, ship to name, bill to |
| customer.email | email, e-mail, customer email, buyer email |
| expense.amount | amount, cost, value, spend, paid, total |
| purchase.supplier_ref | supplier, vendor, from, manufacturer, maker |

**Value synonyms:**

- **Channel:** website/web/shopify/woo → `online_store`; etsy → `etsy`; amazon/amz → `amazon`;
  ebay → `ebay`; instagram/ig/facebook/tiktok shop → `social`; shop/till/pos/in store/walk-in/market →
  `in_store`; wholesale/trade/b2b → `wholesale`.
- **Payment status:** Y/yes/paid/✓ → `paid`; N/no/unpaid/outstanding → `unpaid`; part/partial → `partial`.
- **Order status:** cancelled/canceled/void → `cancelled`; refunded → `refunded`.

### 2.3 Messy-data patterns

| id | Pattern | Detection hints | Implied cleaning rules |
|---|---|---|---|
| `title_rows` | Title/banner rows above the real header ("FERNWOOD SALES 2026") | Single non-empty merged cell spanning columns above a dense row | `skip_rows_before_header` |
| `multi_row_header` | Two header rows ("Sales" over "Qty / Amount") | Merged cells in row above a header-like row | `combine_header_rows` |
| `section_header_rows` | Category written as a row ("CANDLES") with products below | Row with one non-empty cell, all-caps or bold, followed by data rows | `fill_down_from_section` → product.category |
| `totals_rows` | "Total", "Grand total", "Subtotal" rows | Keyword match and/or numeric cells ≈ sum of rows above | `skip_rows(match=totals)` |
| `blank_and_note_rows` | Blank rows, "notes:", "DISCONTINUED - do not reorder" | Empty or single long-text rows | `skip_rows`, or attach note to previous record (`note_to_previous`) |
| `denormalised_orders` | Order fields repeated on every item row | order_number repeats with identical date/customer | `split_entity` → sale + sale_line |
| `blank_repeat_cells` | Order fields only on first line, blank below | Blanks in order columns where order_number blank but item present | `fill_down` |
| `numbers_as_text` | "1,234.50", "$12.00", "12.50 USD", "(45.00)", "12,50" | Text column where ≥80% parse as numbers | `parse_number(locale, currency, parens_negative)` |
| `units_in_values` | "12 pcs", "3 boxes", "2kg" | Numeric prefix + unit token | `strip_unit` (+ conversion factor if confirmed) |
| `mixed_dates` | Excel serials, "03/04/2026", "4 Mar 26", "2026-03-04 14:22" | Multiple date formats in one column | `parse_date(formats[], date_order)` |
| `wide_months` | Month names as columns (Jan, Feb, …) | ≥3 headers parse as months/periods | `unpivot(columns → period, value)` |
| `one_sheet_per_period` | Sheets named "Q1 2026", "Jan", "2025" with same headers | Sheet-name dates + matching header signatures | `union_sheets(add_period_from_sheet_name)` |
| `near_duplicate_names` | "Bloom & Co", "Bloom and Co.", "BLOOM & CO LTD" | Normalised key / trigram similarity ≥ 0.85 | `dedupe(suggest_clusters)`; user confirms |
| `yes_no_variants` | Y/N/✓/x/TRUE/"paid" | Low-cardinality boolean-ish values | `parse_boolean(map)` |
| `placeholder_nulls` | "-", "n/a", "TBC", "?", "0000-00-00" | Repeated sentinel values | `null_if([...])` |
| `refund_as_negative` | Negative quantity/amount rows meaning returns | Negative qty with same order/product | `route_to_entity(return)` (confirm) |
| `tax_inclusive_prices` | Prices include VAT/sales tax | Header contains "inc vat", "incl. tax" | assumption flag; `tax_inclusive=true` on field |

### 2.4 Known export formats (high-confidence mappings)

| Format id | Signature headers (subset) | Maps to |
|---|---|---|
| `shopify_orders` | Name, Email, Financial Status, Paid at, Lineitem quantity, Lineitem name, Lineitem price, Lineitem sku, Discount Amount, Shipping, Taxes, Total, Billing Name | sale + sale_line + customer (split) |
| `shopify_products` | Handle, Title, Variant SKU, Variant Price, Cost per item, Variant Inventory Qty, Type, Vendor | product (+ stock_count) |
| `etsy_sold_orders` | Sale Date, Order ID, Buyer, Number of Items, Order Value, Discount Amount, Shipping, Sales Tax | sale + customer |
| `etsy_order_items` | Sale Date, Item Name, Quantity, Price, Order ID, SKU | sale_line |
| `amazon_order_report` | amazon-order-id, purchase-date, sku, product-name, quantity, item-price | sale + sale_line |
| `woocommerce_orders` | Order Number, Order Date, Billing First Name, Item Name, Quantity, Item Cost | sale + sale_line + customer |
| `square_items` | Date, Time, Category, Item, Qty, Gross Sales, Discounts, Net Sales, Transaction ID | sale + sale_line (`in_store`) |

Signatures are matched on normalised headers (≥70% overlap). Exact header names drift between versions, so
these are hints that raise confidence, never hard requirements.

### 2.5 Metrics

| id | Label | Definition (plain language; shown in "How I calculated this") | Requires |
|---|---|---|---|
| `gross_sales` | Sales before discounts | Item price × quantity for completed sales, before discounts | sale_line.quantity, unit_price |
| `discounts` | Discounts given | Total discounts on completed sales | sale_line.discount or sale.discount_total |
| `refunds` | Refunds | Money refunded on returns | return.refund_amount |
| `net_sales` | Net sales | Sales after discounts and refunds; excludes tax and shipping charged | sale_line.line_total |
| `units_sold` | Items sold | Number of items sold on completed sales, minus returned items | sale_line.quantity |
| `order_count` | Orders | Number of completed orders | sale.order_number |
| `average_order_value` | Average order value | Net sales ÷ orders | net_sales, order_count |
| `items_per_order` | Items per order | Items sold ÷ orders | units_sold, order_count |
| `cogs` | Cost of goods sold | Items sold × their cost (cost at time of sale if known, else current product cost) | product.unit_cost or sale_line.unit_cost_at_sale |
| `gross_profit` | Gross profit | Net sales − cost of goods sold | net_sales, cogs |
| `gross_margin_pct` | Profit margin | Gross profit ÷ net sales | gross_profit, net_sales |
| `customer_count` | Customers who bought | Distinct customers with a completed sale in the period | sale.customer_ref |
| `new_customers` | New customers | Customers whose first-ever order is in the period | sale.customer_ref, sale_date |
| `repeat_customer_rate` | Returning customers | Share of customers in the period who had ordered before | sale.customer_ref |
| `customer_revenue` | Customer spend | Net sales per customer | net_sales, customer |
| `lapsed_customers` | Customers who stopped ordering | Customers with ≥3 past orders whose time since last order is > 2× their usual gap (and > 30 days) | sale.customer_ref, sale_date |
| `stock_on_hand` | Items in stock | Latest stock count adjusted for sales and deliveries since (method shown) | stock_count.quantity_on_hand |
| `stock_value` | Stock value (at cost) | Items in stock × unit cost | stock_on_hand, product.unit_cost |
| `daily_sales_rate` | Average items sold per day | Items sold over the last 28 days ÷ 28 (per product) | sale_line.quantity |
| `days_of_cover` | Days of stock left | Items in stock ÷ average items sold per day | stock_on_hand, daily_sales_rate |
| `dead_stock_value` | Money tied up in unsold stock | Stock value of products with stock but no sales in 90 days | stock_value, sale_line |
| `sell_through_rate` | Sell-through | Items sold ÷ (items sold + items in stock) over the period | units_sold, stock_on_hand |
| `return_rate` | Return rate | Items returned ÷ items sold | return.quantity, units_sold |
| `expenses_total` | Expenses | Sum of expenses | expense.amount |
| `net_profit_estimate` | Profit after expenses (estimate) | Gross profit − expenses (labelled as estimate: excludes items not recorded) | gross_profit, expenses_total |
| `outstanding_receivables` | Money owed to you | Unpaid/partly paid sales totals minus payments received | sale.payment_status or payment |
| `overdue_receivables` | Overdue money owed | Owed amounts past their due date (or invoice date + terms) | outstanding_receivables, due_date or terms |
| `supplier_spend` | Spent with suppliers | Total of supplier orders | purchase.total or purchase_line |

**Standard dimensions:**

- product (name, category, brand)
- customer (name, type, city, region)
- channel
- sales place
- supplier
- time (day/week/month/quarter/year in the workspace timezone)

**Ambiguity defaults** (stated as assumptions when used):

| Term | Default |
|---|---|
| "sales" / "revenue" | `net_sales` |
| "profit" | `gross_profit` |
| "best" | highest `net_sales` |
| "last month" | previous calendar month |
| "this year" | calendar year, unless `fiscal_year_start_month` is set |

"Top customers" asks a clarifying question (by spend or by number of orders?) unless a preference has been
saved.

### 2.6 Default dashboard ("Your business at a glance")

Desktop layout is a 12-column grid. Mobile stacks tiles in the listed order. The default date range is the
last 30 days, compared with the previous 30 days.

| # | Tile | Query | Chart | Size |
|---|---|---|---|---|
| 1 | Net sales | net_sales, compare previous period | kpi | 3×2 |
| 2 | Gross profit | gross_profit, compare | kpi | 3×2 |
| 3 | Orders | order_count, compare | kpi | 3×2 |
| 4 | Average order value | average_order_value, compare | kpi | 3×2 |
| 5 | Sales over time | net_sales by week (month if range > 120 days) | line | 8×4 |
| 6 | Sales by channel | net_sales by channel | bar_horizontal | 4×4 |
| 7 | Top products by profit | gross_profit by product, top 10 | bar_horizontal | 6×5 |
| 8 | Running low | products with days_of_cover < 14, sorted ascending | table | 6×5 |
| 9 | Top customers | net_sales by customer, top 10 | table | 6×5 |
| 10 | Profit margin by category | gross_margin_pct by product.category | bar | 6×5 |
| 11 | Money tied up in slow stock | dead_stock_value + list | kpi + table | 6×4 |
| 12 | Money owed to you | outstanding_receivables, overdue_receivables | kpi | 6×4 (only if wholesale data) |

### 2.7 Insight and alert rules

| id | Category | Detects | Default thresholds | Example text (numbers are placeholders filled by code) |
|---|---|---|---|---|
| `stockout_risk` | stock | Products with days_of_cover below threshold and daily_sales_rate > 0 | warn < 14 days, urgent < 7 | "**{{product}}** will run out in about {{days}} days at the current sales rate ({{rate}} a day). You have {{on_hand}} left." |
| `dead_stock` | stock | Products with stock but no sales in N days | 90 days, value > {{min_value}} | "{{count}} products haven't sold in 90 days. They're holding {{value}} of your money, led by **{{top_product}}**." |
| `customer_slipping` | customers | Repeat customers whose last 60 days spend is ≥ X% below their prior 6-month average, or who are overdue by their usual gap | drop ≥ 50%, ≥ 3 prior orders, usual spend ≥ $200 per 60 days (ADR-047) | "**{{customer}}**'s orders dropped {{drop_pct}} compared with their usual. Their last order was {{days_since}} days ago." |
| `margin_squeeze` | profit | Products whose latest supplier cost rose ≥ X% while selling price didn't | ≥ 10% | "The cost of **{{product}}** went up {{cost_change}} but your price hasn't changed. Your margin fell from {{old_margin}} to {{new_margin}}." |
| `return_spike` | products | Products with return rate ≥ X and ≥ N returns in last 60 days | ≥ 10%, ≥ 5 returns | "**{{product}}** is being returned a lot: {{return_rate}} of sales in the last 60 days. Top reason: {{top_reason}}." |
| `rising_star` | products | Products whose last-28-day sales are ≥ X% above the prior 28 days | ≥ 50%, min 25 units, wholesale orders excluded (ADR-047) | "**{{product}}** is taking off: sales are up {{change}} in the last 4 weeks." |
| `sales_change` | trends | Week-over-week or month-over-month net sales change beyond threshold | ±25% | "Sales this week are {{direction}} {{change}} compared with last week ({{this_week}} vs {{last_week}})." |
| `channel_shift` | trends | A channel's share of sales changed by ≥ X points vs prior 90 days | ≥ 10 pts | "**{{channel}}** now brings in {{share}} of your sales, up from {{prev_share}}." |
| `overdue_payments` | cash | Customers with overdue receivables | > 0 days overdue, ≥ min amount | "{{count}} customers owe you {{amount}} that's overdue. The largest is **{{customer}}** ({{customer_amount}}, {{days}} days late)." |
| `reorder_suggestion` | stock | Pairs with stockout_risk: suggests a quantity covering lead time + 30 days | supplier lead_time or 14 days; shown as the stock-out card's context line (ADR-047) | "Consider reordering about {{qty}} of **{{product}}** from {{supplier}} to cover the next {{days}} days." |

**Severity score:** `impact (money at stake, normalised) × urgency (time to impact) × confidence`. The top 5
are shown on Home. Everything is visible under "All insights".

### 2.8 Example questions (suggestion chips)

**Sales:**

- How much did I sell last month?
- Which channel is growing fastest?
- Show sales by week this year.
- What were my best days of the week?

**Products:**

- Which products made me the most profit last month?
- What's not selling?
- Which products have the best margins?
- What's my best seller on Etsy?

**Stock:**

- What's about to run out?
- How much money is tied up in stock?
- What should I reorder this week?

**Customers:**

- Who are my top customers?
- Which customers stopped ordering?
- How many new customers did I get this month?
- What share of customers come back?

**Money:**

- What did I spend on ads this year?
- What's my profit after expenses this quarter?
- Who owes me money?

### 2.9 Domain primer (prompt fragment, `prompts/domain_primer.md`)

A short (~300 words) primer injected into AI system prompts. It covers:

- the typical files of a small retailer and what each represents
- that order exports are usually line-level
- that "Name" in Shopify exports is the order number
- that negative quantities often mean returns
- that "cost" columns on stock lists are unit costs unless a quantity column is absent
- that totals rows are common
- that sellers often keep one sheet per month or quarter

The primer is reviewed like code and versioned with the pack.
