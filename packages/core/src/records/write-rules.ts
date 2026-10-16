import type { CatalogEntity } from '../change-plan/compile';
import type { FieldDef } from '../change-plan/schema';
import { words } from './lookup';
import { titleFieldOf } from './values';

/**
 * Task H, rules first: the common ways owners add or change a record, read without the AI. Pure.
 * The result names records by what was typed ("mentions"); the service looks them up.
 */

export interface DraftPart {
  entity: string;
  values: Record<string, string>;
  /** Reference field → what was typed ("Bloom & Co"). */
  mentions: Record<string, string>;
}

export type Draft =
  | (DraftPart & { operation: 'insert'; lines: DraftPart[] })
  | (DraftPart & { operation: 'update'; target: string });

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const CHANNELS: [RegExp, string][] = [
  [/\b(?:on|via|through|from|in)\s+etsy\b/i, 'etsy'],
  [/\b(?:on|via|through|from|in)\s+amazon\b/i, 'amazon'],
  [/\b(?:on|via|through|from|in)\s+ebay\b/i, 'ebay'],
  [
    /\b(?:on|via|through|from)\s+(?:my |our |the )?(?:website|web ?shop|online store|site)\b|\bonline\b/i,
    'online_store',
  ],
  [/\b(?:on|via|through|from)\s+(?:instagram|facebook|tiktok|social(?: media)?)\b/i, 'social'],
  [/\bin (?:the |my |our )?(?:shop|store)\b|\bin person\b/i, 'in_store'],
  [/\bwholesale\b/i, 'wholesale'],
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** "today", "yesterday", "on 3 Oct", "on October 3, 2026", "on 2026-10-03" → YYYY-MM-DD, removed from the text. */
export function takeDate(text: string, today: string): { date: string | null; rest: string } {
  const base = new Date(`${today}T12:00:00Z`);
  const m1 = /\b(today|yesterday)\b/i.exec(text);
  if (m1) {
    const d = new Date(base);
    if (m1[1]!.toLowerCase() === 'yesterday') d.setUTCDate(d.getUTCDate() - 1);
    return { date: iso(d), rest: text.replace(m1[0], ' ') };
  }
  const m2 = /\bon\s+(\d{4})-(\d{2})-(\d{2})\b/i.exec(text);
  if (m2) return { date: `${m2[1]}-${m2[2]}-${m2[3]}`, rest: text.replace(m2[0], ' ') };
  const month = `(${MONTHS.join('|')})[a-z]*\\.?`;
  const m3 = new RegExp(
    `\\bon\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}(?:,?\\s+(\\d{4}))?\\b`,
    'i',
  ).exec(text);
  const m4 = new RegExp(
    `\\bon\\s+${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    'i',
  ).exec(text);
  const hit = m3
    ? {
        day: Number(m3[1]),
        month: MONTHS.indexOf(m3[2]!.toLowerCase().slice(0, 3)),
        year: m3[3],
        raw: m3[0],
      }
    : m4
      ? {
          day: Number(m4[2]),
          month: MONTHS.indexOf(m4[1]!.toLowerCase().slice(0, 3)),
          year: m4[3],
          raw: m4[0],
        }
      : null;
  if (hit && hit.month >= 0 && hit.day >= 1 && hit.day <= 31) {
    let year = hit.year ? Number(hit.year) : base.getUTCFullYear();
    // A date without a year that would be in the future means last year.
    if (!hit.year && Date.UTC(year, hit.month, hit.day) > base.getTime()) year -= 1;
    return {
      date: `${year}-${pad(hit.month + 1)}-${pad(hit.day)}`,
      rest: text.replace(hit.raw, ' '),
    };
  }
  return { date: null, rest: text };
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:;-]+|[\s,.;:-]+$/g, '')
    .trim();
const amount = (s: string) => s.replace(/[$£€,\s]/g, '');

export function entityByWord(
  catalog: readonly CatalogEntity[],
  word: string,
): CatalogEntity | undefined {
  const w = words(word).join(' ');
  return catalog.find(
    (e) =>
      words(e.label.singular).join(' ') === w ||
      words(e.label.plural).join(' ') === w ||
      words(e.key).join(' ') === w,
  );
}

/** Words owners use for details, beyond their labels. */
const ALIASES: Record<string, string[]> = {
  unit_price: ['price', 'selling price', 'sell price', 'retail price'],
  unit_cost: ['cost', 'cost price', 'unit cost', 'buy price'],
  sku: ['code', 'sku', 'product code'],
  email: ['email', 'email address', 'e-mail'],
  phone: ['phone', 'phone number', 'number', 'mobile'],
  city: ['city', 'town'],
  reorder_point: ['reorder point', 'reorder level', 'reorder at'],
  payment_terms_days: ['payment terms', 'terms', 'days to pay'],
  status: ['status'],
  payment_status: ['payment', 'paid', 'payment status'],
  sale_date: ['date', 'sale date'],
  total: ['total', 'order total'],
};

export function fieldByWords(e: CatalogEntity, text: string): FieldDef | undefined {
  const w = words(text).join(' ');
  if (!w) return undefined;
  return (
    e.fields.find((f) => words(f.label).join(' ') === w) ??
    e.fields.find((f) => (ALIASES[f.key] ?? []).some((a) => words(a).join(' ') === w)) ??
    e.fields.find((f) => words(f.key).join(' ') === w)
  );
}

/** The leading words of `segment` that name a detail of `e`, and the rest. */
function leadingField(e: CatalogEntity, segment: string): { field: FieldDef; rest: string } | null {
  const parts = segment.trim().split(/\s+/);
  for (let n = Math.min(4, parts.length - 1); n >= 1; n--) {
    const head = parts.slice(0, n).join(' ').replace(/[:=]$/, '');
    const f = fieldByWords(e, head);
    if (f)
      return {
        field: f,
        rest: clean(
          parts
            .slice(n)
            .join(' ')
            .replace(/^(?:is|of|=|:|to)\s+/i, ''),
        ),
      };
  }
  return null;
}

/** An allowed value named by the owner ("refunded", "on hold") on any list detail of `e`. */
function allowedValue(e: CatalogEntity, text: string): { field: FieldDef; value: string } | null {
  const v = words(text).join('_');
  for (const f of e.fields)
    for (const a of f.allowedValues ?? [])
      if (words(a.replace(/_/g, ' ')).join('_') === v) return { field: f, value: a };
  if (/^(paid|unpaid)$/.test(v)) {
    const f = e.fields.find((x) => x.key === 'payment_status');
    if (f) return { field: f, value: v };
  }
  return null;
}

/** Turn a value someone typed for a field into what the field expects (the service checks it again). */
function valueFor(f: FieldDef, raw: string): string {
  const s = clean(raw).replace(/^["“”']|["“”']$/g, '');
  if (['money', 'decimal', 'integer'].includes(f.type)) return amount(s);
  if (f.type === 'boolean')
    return /^(?:yes|y|true|1|on)$/i.test(s)
      ? 'true'
      : /^(?:no|n|false|0|off)$/i.test(s)
        ? 'false'
        : s;
  if (f.allowedValues?.length) {
    const v = words(s).join('_');
    return f.allowedValues.find((a) => words(a.replace(/_/g, ' ')).join('_') === v) ?? s;
  }
  return s;
}

export function draftWithRules(
  request: string,
  catalog: readonly CatalogEntity[],
  ctx: { today: string },
): Draft | null {
  const text = clean(request.replace(/^(?:please|can you|could you|pls)\s+/i, ''));
  if (!text) return null;
  return (
    saleDraft(text, catalog, ctx) ??
    updateDraft(text, catalog, ctx) ??
    insertDraft(text, catalog, ctx)
  );
}

function saleDraft(
  text: string,
  catalog: readonly CatalogEntity[],
  ctx: { today: string },
): Draft | null {
  const sale = catalog.find((e) => e.key === 'sale');
  const line = catalog.find((e) => e.key === 'sale_line');
  if (!sale || !line) return null;
  // "Add a sale: …", "New order: …", "Record a wholesale sale of …", "I sold …".
  const verb =
    /^(?:add|record|log|enter|put in|new)\s+(?:a\s+|an\s+)?(?:new\s+)?(?<kind>(?:wholesale|online|website|etsy|amazon|ebay)\s+)?(?:sale|order)\b(?:\s+of\b)?[:,-]?\s*(?<body>.+)$/i.exec(
      text,
    ) ?? /^(?:i\s+|we\s+)?(?:just\s+)?sold\s+(?<body>.+)$/i.exec(text);
  if (!verb?.groups?.body) return null;
  const kind = verb.groups.kind?.trim().toLowerCase();
  let body = ` ${verb.groups.body} ${kind === 'wholesale' ? 'wholesale' : kind ? `on ${kind}` : ''} `;
  const values: Record<string, string> = {};
  const { date, rest } = takeDate(body, ctx.today);
  body = rest;
  if (date) values.sale_date = date;
  for (const [re, v] of CHANNELS)
    if (re.test(body) && sale.fields.find((f) => f.key === 'channel')?.allowedValues?.includes(v)) {
      values.channel = v;
      body = body.replace(re, ' ');
      break;
    }
  let price: string | null = null;
  // A price says so: "$12", "at 12", "12 each" (but "for 2 mugs" is a quantity).
  const pm =
    /\s(?:at|for|@)\s*(?:[$£€]\s*(\d+(?:[.,]\d{1,2})?)(?:\s*(?:each|apiece|a piece|per item|per unit|ea)\b)?|(\d+(?:[.,]\d{1,2})?)\s*(?:each|apiece|a piece|per item|per unit|ea)\b)(?=\s|$)/i.exec(
      body,
    ) ?? /\s(?:at|@)\s*(\d+(?:[.,]\d{1,2})?)(?=\s|$)/i.exec(body);
  if (pm) {
    price = (pm[1] ?? pm[2]!).replace(',', '.');
    body = body.replace(pm[0], ' ');
  }
  body = body.replace(/^\s*(?:for|of|with)\s+/i, ' ');
  const mentions: Record<string, string> = {};
  // "to Bloom & Co" (not "for 2 mugs").
  const cm = /\s(?:to|for)\s+(?!\d|an?\s)(.+?)\s*$/i.exec(body);
  if (cm) {
    mentions.customer = clean(cm[1]!);
    body = body.slice(0, cm.index);
  }
  const lines: DraftPart[] = clean(body)
    .split(/\s*(?:,|\+|\band\b|&)\s*/i)
    .map((s) => clean(s))
    .filter(Boolean)
    .map((s) => {
      const q =
        /^(\d+(?:\.\d+)?)\s*(?:x|×|of)?\s+(.+)$/i.exec(s) ?? /^(?:an?|one)\s+(.+)$/i.exec(s);
      const qty = q && q.length === 3 ? q[1]! : '1';
      const name = clean(q ? q[q.length - 1]! : s);
      return { entity: line.key, values: { quantity: qty }, mentions: { product: name } };
    });
  if (lines.length === 0) return null;
  if (price) lines[lines.length - 1]!.values.unit_price = price;
  return { operation: 'insert', entity: sale.key, values, mentions, lines };
}

function updateDraft(
  text: string,
  catalog: readonly CatalogEntity[],
  ctx: { today: string },
): Draft | null {
  const sale = catalog.find((e) => e.key === 'sale');
  // "Mark order 1043 as refunded", "Order 1043 was cancelled".
  const status =
    /^mark\s+(?:the\s+)?(.+?)\s+as\s+(.+)$/i.exec(text) ??
    /^((?:order|sale)\s+#?[\w-]+)\s+(?:was|is|has been|got|is now)\s+(.+)$/i.exec(text);
  if (status) {
    const { entity, mention } = recordMention(catalog, status[1]!);
    const target = entity ?? (/^(?:order|sale)\b|^#/i.test(status[1]!) ? sale : undefined);
    const e = target ?? catalog.find((x) => allowedValue(x, status[2]!));
    if (!e) return null;
    const av = allowedValue(e, status[2]!);
    if (!av) return null;
    return {
      operation: 'update',
      entity: e.key,
      target: mention,
      values: { [av.field.key]: av.value },
      mentions: {},
    };
  }
  // "Change the price of Sage Stoneware Mug to $20", "Set the city for Bloom & Co to Portland".
  const a =
    /^(?:change|set|update|make)\s+(?:the\s+)?(.+?)\s+(?:of|for|on)\s+(.+?)\s+(?:to|=)\s+(.+)$/i.exec(
      text,
    );
  // "Set Bloom & Co's city to Portland".
  const b = /^(?:change|set|update)\s+(.+?)['’]s?\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  const parts = a
    ? { field: a[1]!, record: a[2]!, value: a[3]! }
    : b
      ? { field: b[2]!, record: b[1]!, value: b[3]! }
      : null;
  if (!parts) return null;
  const { entity, mention } = recordMention(catalog, parts.record);
  const options = entity
    ? [entity]
    : catalog.filter((e) => fieldByWords(e, parts.field) && titleFieldOf(e.fields));
  // Prefer the record types people name most (products, customers, suppliers) when several fit.
  const order = ['product', 'customer', 'supplier', 'sale', 'location'];
  const e = [...options].sort(
    (x, y) => ((order.indexOf(x.key) + 99) % 99) - ((order.indexOf(y.key) + 99) % 99),
  )[0];
  if (!e) return null;
  const f = fieldByWords(e, parts.field);
  if (!f) return null;
  if (f.type === 'reference')
    return {
      operation: 'update',
      entity: e.key,
      target: mention,
      values: {},
      mentions: { [f.key]: clean(parts.value) },
    };
  let value = valueFor(f, parts.value);
  if (f.type === 'date' || f.type === 'datetime')
    value = takeDate(` on ${value} `, ctx.today).date ?? takeDate(value, ctx.today).date ?? value;
  return {
    operation: 'update',
    entity: e.key,
    target: mention,
    values: { [f.key]: value },
    mentions: {},
  };
}

/** "order 1043" → a sale by number; "Bloom & Co" → just the words (the record type comes from the field). */
function recordMention(
  catalog: readonly CatalogEntity[],
  raw: string,
): { entity?: CatalogEntity; mention: string } {
  const s = clean(raw.replace(/^the\s+/i, ''));
  const order =
    /^(?:order|sale)\s+(?:number\s+|no\.?\s*)?#?([\w-]+)$/i.exec(s) ?? /^#([\w-]+)$/.exec(s);
  const sale = catalog.find((e) => e.key === 'sale');
  if (order && sale) return { entity: sale, mention: order[1]! };
  const typed = /^(?:the\s+)?(\w+)\s+(.+)$/.exec(s);
  if (typed) {
    const e = entityByWord(catalog, typed[1]!);
    if (e && e.key !== 'sale') return { entity: e, mention: clean(typed[2]!) };
  }
  return { mention: s };
}

function insertDraft(
  text: string,
  catalog: readonly CatalogEntity[],
  ctx: { today: string },
): Draft | null {
  const m =
    /^(?:add|create|new|record|log)\s+(?:a\s+|an\s+)?(?:new\s+)?([a-z]+(?:\s+[a-z]+)?)\b(?:\s+(?:called|named))?[:,-]?\s*(.*)$/i.exec(
      text,
    );
  if (!m) return null;
  let e = entityByWord(catalog, m[1]!);
  let body = m[2]!;
  if (!e) {
    // "Add a sale item" style two-word names didn't match: try the first word alone.
    const first = m[1]!.split(/\s+/)[0]!;
    e = entityByWord(catalog, first);
    if (e) body = `${m[1]!.slice(first.length)} ${body}`;
  }
  if (!e || e.key === 'sale' || e.key === 'sale_line') return null;
  const values: Record<string, string> = {};
  const mentions: Record<string, string> = {};
  const title = titleFieldOf(e.fields);
  const { date, rest } = takeDate(` ${body} `, ctx.today);
  if (date && e.timeField) {
    values[e.timeField] = date;
    body = rest;
  }
  body = clean(body);
  // "$45 for postage" (an expense).
  const moneyFields = e.fields.filter((f) => f.type === 'money');
  const lead = /^[$£€]\s*(\d+(?:[.,]\d{1,2})?)\s*(?:for|on)?\s*(.*)$/i.exec(body);
  if (lead && moneyFields.length) {
    const target = moneyFields.find((f) => f.required) ?? moneyFields[0]!;
    values[target.key] = lead[1]!.replace(',', '.');
    body = lead[2]!;
    const note =
      e.fields.find((f) => f.semantic === 'note') ?? e.fields.find((f) => f.key === 'description');
    if (note && body && !/,/.test(body)) {
      values[note.key] = clean(body);
      body = '';
    }
  }
  body = body.replace(/^(?:called|named)\s+/i, '');
  // "Juniper Goods in Austin": a place after the name.
  const cityField = e.fields.find((f) => f.semantic === 'city');
  const place = cityField
    ? /^([^,]+?)\s+(?:in|from|based in)\s+([A-Z][^,]*)(,.*)?$/.exec(body)
    : null;
  if (place && cityField) {
    values[cityField.key] = clean(place[2]!);
    body = `${place[1]!}${place[3] ?? ''}`;
  }
  const segments = body
    .split(/\s*(?:,|;|\bwith\b|\band\b(?=\s+(?:a|an|the)?\s*[a-z]+\s+(?:of\s+)?[$£€\d]))\s*/i)
    .map(clean)
    .filter(Boolean);
  for (const [i, seg] of segments.entries()) {
    const city = /^(?:in|from|based in)\s+(.+)$/i.exec(seg);
    const lf = leadingField(e, seg);
    if (lf && lf.rest) {
      if (lf.field.type === 'reference') mentions[lf.field.key] = lf.rest;
      else values[lf.field.key] = valueFor(lf.field, lf.rest);
    } else if (city && e.fields.some((f) => f.semantic === 'city')) {
      values[e.fields.find((f) => f.semantic === 'city')!.key] = clean(city[1]!);
    } else if (
      city &&
      e.fields.some((f) => f.type === 'reference' && f.references === 'supplier')
    ) {
      mentions[e.fields.find((f) => f.type === 'reference' && f.references === 'supplier')!.key] =
        clean(city[1]!);
    } else if (i === 0 && title && values[title] === undefined) {
      values[title] = seg.replace(/^["“”']|["“”']$/g, '');
    } else return null; // something we can't place: let the AI (or the owner) say
  }
  if (Object.keys(values).length === 0 && Object.keys(mentions).length === 0) return null;
  return { operation: 'insert', entity: e.key, values, mentions, lines: [] };
}
