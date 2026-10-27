# BizRetriever API, MCP server and webhooks (M16)

For developers connecting another app to one business. Owners set this up under **Settings →
Connect other apps**. Design and safety reasoning: ADR-066.

Everything here is **read-only**. Nothing reached with a key can change records, the set-up, the
dashboard or alerts. Every number is worked out by BizRetriever from the business's records: a
typed query compiled by our code and run as that business's read-only database role. No SQL is
ever accepted.

## Keys

- The owner makes a key on Connect other apps. It starts with `bzr_` and is shown **once**. We
  keep only its SHA-256 hash.
- A key reads exactly one business, with the rights of a "can view" member.
- Revoking a key takes effect on the next request.
- Limit: 60 requests per key per minute. Over that you get `429` with `Retry-After` (seconds).
- Demo businesses can't have keys.

Send the key as a bearer token:

```
Authorization: Bearer bzr_…
```

## REST API

Base address: `https://<your BizRetriever>/api/v1`. The full description is at
`/api/v1/openapi.json` (OpenAPI 3.1, no key needed).

| Call | What it returns |
|---|---|
| `GET /business` | name, industry, currency, time zone, today's date in the business's time zone |
| `GET /measures` | measures (`key`, `label`, `description`, `format`, `available`) and the details numbers can be broken down by (`product.category`, `customer.name`, …) with example values |
| `POST /query` | numbers for a typed query (below) |
| `POST /ask` | `{ "question": "…" }`: answers a plain-words question as Ask does |
| `GET /insights?limit=20` | things worth knowing, most important first |
| `GET /dashboard?period=last_30_days&compare=true` | each dashboard tile's numbers or table, formatted; `period` is a preset or `YYYY-MM-DD..YYYY-MM-DD` |

### A query

The same typed form the app's question interpreter produces. Only `metrics` is required.

```json
{
  "metrics": ["net_sales", "gross_profit"],
  "dimensions": [{ "field": "product.category" }],
  "filters": [{ "field": "sale.channel", "op": "eq", "values": ["etsy"] }],
  "having": [{ "metric": "net_sales", "op": "gt", "value": 100 }],
  "timeRange": { "preset": "last_month" },
  "compareTo": "previous_period",
  "orderBy": { "by": "net_sales", "dir": "desc" },
  "limit": 10
}
```

- `dimensions`: up to 2 entries, each `{ "field": "record.detail" }` or `{ "time": "day" | "week" | "month" | "quarter" | "year" }`.
- `timeRange`: a preset (`today`, `yesterday`, `last_7_days`, `last_28_days`, `last_30_days`, `last_90_days`, `this_week`, `last_week`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_year`, `all_time`) or `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`. Default: `all_time`. Presets count from the business's today.
- Filter `op`: `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`.

The response:

```json
{
  "title": "Net sales by category · September 2026",
  "period": { "from": "2026-09-01", "to": "2026-09-30", "label": "September 2026" },
  "columns": [{ "key": "d0", "label": "Category", "kind": "dimension" }, { "key": "m_net_sales", "label": "Net sales", "kind": "metric", "format": "money" }],
  "rows": [{ "d0": "Mugs", "m_net_sales": "4210.5000" }],
  "text": [{ "d0": "Mugs", "m_net_sales": "$4,210.50" }],
  "totalRows": 6,
  "truncated": false,
  "assumptions": []
}
```

- `rows` holds values as the database returned them: money and decimals are exact strings, never floats.
- `text` holds the same values formatted as the app shows them.
- `period.to` is the last day included.

### Errors

Errors come back as `{ "error": { "code", "message" } }`:

| Status | Meaning |
|---|---|
| `400` | not JSON, or not a valid query (`invalid_query`) |
| `401` | missing, unknown or revoked key |
| `422` | a measure or detail this business doesn't have (`unknown_measure`, `cannot_answer`) |
| `429` | rate limited |

## MCP server (AI assistants)

- Address: `https://<your BizRetriever>/api/mcp`.
- Transport: MCP Streamable HTTP without sessions. Each `POST` carries one JSON-RPC message and
  gets a JSON response. There's no server-sent stream, so `GET` returns 405.
- Protocol versions: 2025-11-25, 2025-06-18 and 2025-03-26.
- Authentication: the same key, as `Authorization: Bearer bzr_…`. Requests from a browser must
  come from BizRetriever's own origin.

| Tool | Same as |
|---|---|
| `get_business` | `GET /business` |
| `list_measures` | `GET /measures` |
| `run_query` | `POST /query` (input schema = the query above) |
| `ask_question` | `POST /ask` |
| `list_insights` | `GET /insights` |
| `get_dashboard` | `GET /dashboard` (`{ period?, compare? }`) |

- All tools are annotated `readOnlyHint: true`.
- Results carry `structuredContent` and a text copy that starts by saying the values are the
  business's own records: an assistant should treat them as data, not instructions (customer
  names and product names are typed by people).

For a client that takes a URL and headers (for example Claude's custom connectors, or the MCP SDK's
`StreamableHTTPClientTransport` with `requestInit.headers`), point it at the address and set the
`Authorization` header.

## Webhooks

The owner adds an `https://` address and picks events. The signing secret starts with `whsec_` and
is shown **once**.

| Event | When | `data` |
|---|---|---|
| `insight.created` | a new insight is found (after an import, a linked source's update or the daily check) | `{ insight: { id, level, category, text, detail, link } }` |
| `import.completed` | an import or update finished and the data is in | `{ import: { id, kind: "first" \| "update", fromLinkedSource, finishedAt, link } }` |
| `ping` | "Send a test" on Connect other apps | `{ message }` |

Each delivery is a `POST` with a JSON body:

```json
{ "id": "insight:3f1c…", "type": "insight.created", "createdAt": "2026-10-27T09:00:00.000Z",
  "business": { "name": "Fernwood", "slug": "fernwood-ab12" }, "data": { … } }
```

and these headers:

- `BizRetriever-Event`: the event type
- `BizRetriever-Delivery`: unique per delivery; use it to ignore repeats
- `BizRetriever-Signature`: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, keyed with the secret

To check a delivery, recompute the HMAC over the raw body, compare in constant time, and refuse a
`t` more than 5 minutes old (Node):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Delivery rules:

- Answer `2xx` within 10 seconds. Redirects aren't followed and count as failures.
- Retries come after 1 minute, 10 minutes, 1 hour, 6 hours and 24 hours. They are picked up by
  the hourly check, so a wait can run up to an hour longer.
- After the 6th failure the webhook is turned off. The owner sees why and can turn it back on.
- Each event is queued once per webhook. Because of retries, a receiver may still see one twice:
  use `BizRetriever-Delivery`.
- Addresses on private, loopback, link-local or internal networks are refused, both when saved
  and at send time (the address actually connected to is checked).
- Webhooks need `CONNECTOR_SECRET` set on the server, because their secrets are stored encrypted.
