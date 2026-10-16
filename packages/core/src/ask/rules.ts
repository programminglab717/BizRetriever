import type { TimeGrain } from '../semantic/query-spec';
import type { AskCatalog } from './catalog';
import type { Interpretation, QuestionSpec, TimeRange } from './interpretation';
import {
  addDays,
  monthIndex,
  namedMonth,
  periodLabel,
  resolvePreset,
  type TimePreset,
} from './time';

/**
 * Rule-based question interpreter (ADR-040). Recognises the common, clear questions from the pack's
 * words (measure synonyms, breakdowns), the owner's own values (channels, categories, product and
 * customer names) and time phrases. It reports whether it understood every word: when it did, its
 * answer is used as is (no AI, no cost); when it didn't, the AI gets the question.
 */

export interface RulesResult {
  interpretation: Interpretation;
  /** True when every content word of the question was understood. */
  confident: boolean;
  /** Words it didn't understand (for logs and the AI). */
  leftover: string[];
}

type Entry =
  | { kind: 'metric'; phrase: string; id: string }
  | { kind: 'dim'; phrase: string; field: string }
  | { kind: 'value'; phrase: string; field: string; value: string }
  | { kind: 'time'; phrase: string; preset: TimePreset }
  | { kind: 'grain'; phrase: string; grain: TimeGrain }
  | { kind: 'rank'; phrase: string; dir: 'asc' | 'desc' }
  | { kind: 'compare'; phrase: string; to: 'previous_period' | 'same_period_last_year' }
  | { kind: 'table'; phrase: string }
  | { kind: 'who'; phrase: string };

const STOPWORDS = new Set(
  `a an the of in on for to at from with and or by per each all any my our me we us i i'm im you your
  what what's whats which who who's whos whose how much many did do does done is are was were be been
  being has have had having get got give show tell list display see can could would should will shall
  please there this that these those it its it's so far than then as about over up down out more less
  most least just only also now again same time times number amount value values total overall much
  chart graph table there's thing things make made get got look looks like going go goes very really
  ever since between during while when where why come came compare compared vs versus did i'
  week weeks month months year years day days quarter quarters some money share`
    .split(/\s+/)
    .filter(Boolean),
);

const TIME_PHRASES: [string, TimePreset][] = [
  ['today', 'today'],
  ['yesterday', 'yesterday'],
  ['last 7 days', 'last_7_days'],
  ['past 7 days', 'last_7_days'],
  ['past week', 'last_7_days'],
  ['last 28 days', 'last_28_days'],
  ['last 30 days', 'last_30_days'],
  ['past 30 days', 'last_30_days'],
  ['past month', 'last_30_days'],
  ['last 90 days', 'last_90_days'],
  ['past 90 days', 'last_90_days'],
  ['last 3 months', 'last_90_days'],
  ['this week', 'this_week'],
  ['last week', 'last_week'],
  ['this month', 'this_month'],
  ['last month', 'last_month'],
  ['this quarter', 'this_quarter'],
  ['last quarter', 'last_quarter'],
  ['this year', 'this_year'],
  ['so far this year', 'this_year'],
  ['year to date', 'this_year'],
  ['ytd', 'this_year'],
  ['last year', 'last_year'],
  ['all time', 'all_time'],
  ['ever', 'all_time'],
];

const GRAIN_PHRASES: [string, TimeGrain][] = [
  ['by day', 'day'],
  ['per day', 'day'],
  ['each day', 'day'],
  ['daily', 'day'],
  ['by week', 'week'],
  ['per week', 'week'],
  ['each week', 'week'],
  ['weekly', 'week'],
  ['week by week', 'week'],
  ['by month', 'month'],
  ['per month', 'month'],
  ['each month', 'month'],
  ['monthly', 'month'],
  ['month by month', 'month'],
  ['over time', 'month'],
  ['trend', 'month'],
  ['by quarter', 'quarter'],
  ['quarterly', 'quarter'],
  ['by year', 'year'],
  ['yearly', 'year'],
  ['annually', 'year'],
];

const RANK_PHRASES: [string, 'asc' | 'desc'][] = [
  ['top', 'desc'],
  ['best', 'desc'],
  ['most', 'desc'],
  ['highest', 'desc'],
  ['biggest', 'desc'],
  ['largest', 'desc'],
  ['greatest', 'desc'],
  ['leading', 'desc'],
  ['worst', 'asc'],
  ['least', 'asc'],
  ['lowest', 'asc'],
  ['bottom', 'asc'],
  ['smallest', 'asc'],
  ['fewest', 'asc'],
];

const COMPARE_PHRASES: [string, 'previous_period' | 'same_period_last_year'][] = [
  ['growing fastest', 'previous_period'],
  ['growing', 'previous_period'],
  ['grew', 'previous_period'],
  ['growth', 'previous_period'],
  ['going up', 'previous_period'],
  ['going down', 'previous_period'],
  ['changed', 'previous_period'],
  ['change', 'previous_period'],
  ['compared to before', 'previous_period'],
  ['vs before', 'previous_period'],
  ['compared to last year', 'same_period_last_year'],
  ['same time last year', 'same_period_last_year'],
  ['vs last year', 'same_period_last_year'],
  ['year on year', 'same_period_last_year'],
];

/** Generic words for breakdowns (besides the pack's dimension synonyms). */
const DIM_WORDS: Record<string, string[]> = {
  'product.name': ['product', 'products', 'item', 'items'],
  'product.category': ['category', 'categories'],
  'customer.name': [
    'customer',
    'customers',
    'buyer',
    'buyers',
    'client',
    'clients',
    'stockist',
    'stockists',
  ],
  'sale.channel': ['channel', 'channels', 'platform', 'platforms'],
  'supplier.name': ['supplier', 'suppliers', 'vendor', 'vendors'],
  'customer.city': ['city', 'cities', 'town', 'towns'],
  'customer.region': ['state', 'states', 'region', 'regions'],
};

/** Short words owners use for expense types. */
const EXPENSE_ALIASES: Record<string, string> = { ads: 'advertising', ad: 'advertising' };

const GENERIC_SALES = new Set([
  'sales',
  'revenue',
  'takings',
  'turnover',
  'income',
  'sold',
  'sell',
  'selling',
  'money in',
]);
const GENERIC_PROFIT = new Set(['profit', 'profits', 'most profit', 'profitable', 'made me']);

/** Measures that count or average customers. */
const CUSTOMER_MEASURES = new Set([
  'customer_count',
  'new_customers',
  'repeat_customer_rate',
  'customer_revenue',
]);

export function normalizeQuestion(q: string): string {
  return ` ${q
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[?!.,;:()"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

const plural = (w: string) => (w.endsWith('y') ? `${w.slice(0, -1)}ies` : `${w}s`);

function entries(catalog: AskCatalog): Entry[] {
  const out: Entry[] = [];
  for (const m of catalog.metrics)
    for (const s of new Set(m.synonyms))
      out.push({ kind: 'metric', phrase: s.toLowerCase(), id: m.id });
  for (const d of catalog.dimensions) {
    const words = new Set([...d.synonyms, d.label.toLowerCase(), ...(DIM_WORDS[d.field] ?? [])]);
    for (const w of [...words]) words.add(plural(w));
    for (const w of words) out.push({ kind: 'dim', phrase: w.toLowerCase(), field: d.field });
    for (const v of d.values) {
      const phrase = normalizeQuestion(v).trim();
      if (phrase.length < 3 || /^\d+$/.test(phrase) || STOPWORDS.has(phrase)) continue;
      out.push({ kind: 'value', phrase, field: d.field, value: v });
      // "How many Sage Stoneware Mugs": owners pluralise their product names.
      if (!phrase.endsWith('s'))
        out.push({ kind: 'value', phrase: plural(phrase), field: d.field, value: v });
    }
    for (const [canonical, words] of Object.entries(d.valueSynonyms)) {
      for (const w of [...words, canonical.replace(/_/g, ' ')])
        if (w.length >= 3 && !STOPWORDS.has(w))
          out.push({ kind: 'value', phrase: w.toLowerCase(), field: d.field, value: canonical });
    }
  }
  for (const [phrase, preset] of TIME_PHRASES) out.push({ kind: 'time', phrase, preset });
  for (const [phrase, grain] of GRAIN_PHRASES) out.push({ kind: 'grain', phrase, grain });
  for (const [phrase, dir] of RANK_PHRASES) out.push({ kind: 'rank', phrase, dir });
  for (const [phrase, to] of COMPARE_PHRASES) out.push({ kind: 'compare', phrase, to });
  for (const phrase of ['as a table', 'in a table', 'as a list', 'list'])
    out.push({ kind: 'table', phrase });
  out.push({ kind: 'who', phrase: 'who' });
  // Longest phrases first ("profit after expenses" before "profit"); breakdown words before values.
  const priority: Record<Entry['kind'], number> = {
    time: 0,
    compare: 1,
    grain: 2,
    metric: 3,
    dim: 4,
    value: 5,
    table: 6,
    rank: 7,
    who: 8,
  };
  return out.sort(
    (a, b) => b.phrase.length - a.phrase.length || priority[a.kind] - priority[b.kind],
  );
}

interface Parsed {
  /** Every measure phrase found, in question order (a measure can appear more than once). */
  metrics: { id: string; phrase: string; at: number }[];
  dims: string[];
  grain?: TimeGrain;
  values: { field: string; value: string; at: number }[];
  time?: TimeRange;
  timePhrase?: string;
  rank?: 'asc' | 'desc';
  topN?: number;
  compare?: 'previous_period' | 'same_period_last_year';
  table: boolean;
  who: boolean;
  leftover: string[];
}

function parse(question: string, catalog: AskCatalog): Parsed {
  let text = normalizeQuestion(question);
  const p: Parsed = { metrics: [], dims: [], values: [], table: false, who: false, leftover: [] };
  // Matched words are blanked out with bars of the same length, so positions stay put.
  const blank = (at: number, len: number) => {
    text = `${text.slice(0, at + 1)}${'|'.repeat(len - 2)}${text.slice(at + len - 1)}`;
  };
  const take = (re: RegExp) => {
    const m = re.exec(text);
    if (m) blank(m.index, m[0].length);
    return m;
  };

  // Numbers first: "top 5", "last 14 days", "in March 2026", "in 2025".
  const top = take(/ (?:top|best|worst|bottom) (\d{1,3}) /);
  if (top) {
    p.topN = Number(top[1]);
    p.rank = /worst|bottom/.test(top[0]) ? 'asc' : 'desc';
  }
  const lastN = take(/ (?:last|past) (\d{1,3}) (day|days|week|weeks|month|months) /);
  if (lastN) {
    const n = Number(lastN[1]);
    const days = lastN[2]!.startsWith('day') ? n : lastN[2]!.startsWith('week') ? n * 7 : n * 30;
    const to = addDays(catalog.calendar.today, 1);
    p.time = { from: addDays(to, -days), to };
    p.timePhrase = lastN[0].trim();
  }
  const month = take(
    / (?:in |for |during )?(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?: (20\d\d))? /,
  );
  if (month && !p.time) {
    const mi = monthIndex(month[1]!)!;
    p.time = namedMonth(mi, catalog.calendar, month[2] ? Number(month[2]) : undefined);
    p.timePhrase = month[0].trim();
  }
  // Breakdowns we can't do yet: leave a marker so the AI gets the question.
  if (take(/ (?:days? of (?:the )?week|weekdays?|weekends?|hours?|time of day) /))
    p.leftover.push('weekday');
  const year = take(/ (?:in |for |during )?(20\d\d) /);
  if (year && !p.time) {
    const y = Number(year[1]);
    p.time = { from: `${y}-01-01`, to: `${y + 1}-01-01` };
    p.timePhrase = year[0].trim();
  }

  for (const e of entries(catalog)) {
    const needle = ` ${e.phrase} `;
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle)) {
      blank(at, needle.length);
      // "most profit", "best seller": the ranking word is part of the phrase.
      const rank =
        e.kind === 'metric' && RANK_PHRASES.find(([w]) => ` ${e.phrase} `.includes(` ${w} `));
      if (rank) p.rank ??= rank[1];
      switch (e.kind) {
        case 'metric':
          p.metrics.push({ id: e.id, phrase: e.phrase, at });
          break;
        case 'dim':
          if (!p.dims.includes(e.field)) p.dims.push(e.field);
          break;
        case 'value':
          if (!p.values.some((v) => v.field === e.field && v.value === e.value))
            p.values.push({ field: e.field, value: e.value, at });
          break;
        case 'time':
          if (!p.time) {
            p.time = { preset: e.preset };
            p.timePhrase = e.phrase;
          }
          break;
        case 'grain':
          p.grain ??= e.grain;
          break;
        case 'rank':
          p.rank ??= e.dir;
          break;
        case 'compare':
          p.compare ??= e.to;
          break;
        case 'table':
          p.table = true;
          break;
        case 'who':
          p.who = true;
          break;
      }
    }
  }
  p.metrics.sort((a, b) => a.at - b.at);
  p.values.sort((a, b) => a.at - b.at);
  p.leftover.push(
    ...text.split(/[\s|]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
  );
  return p;
}

const sentence = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

export function interpretWithRules(
  question: string,
  catalog: AskCatalog,
  previous?: QuestionSpec,
): RulesResult | null {
  const p = parse(question, catalog);
  const metric = (id: string) => catalog.metrics.find((m) => m.id === id);
  const assumptions: string[] = [];
  const followUp =
    Boolean(previous) &&
    (/^\s*(and|what about|how about|now|only|just|also|same|but)\b/i.test(question) ||
      (p.metrics.length === 0 &&
        (p.dims.length > 0 || p.values.length > 0 || Boolean(p.time) || Boolean(p.grain))));

  // "How many Sage Mugs did I sell?" counts items, not money.
  if (/\bhow many\b/i.test(question))
    for (const m of p.metrics)
      if (m.id === 'net_sales' && ['sell', 'sold', 'selling'].includes(m.phrase))
        m.id = 'units_sold';
  let metrics = [...new Set(p.metrics.map((m) => m.id))];
  if (metrics.length === 0 && followUp && previous) metrics = [...previous.metrics];

  // "Who are my best customers?": by spend or by number of orders? (VERTICAL_PACKS §2.5)
  if (metrics.length === 0 && p.dims.includes('customer.name') && (p.rank || p.who)) {
    const base = (
      m: string,
      label: string,
    ): { label: string; spec: QuestionSpec; assumptions: string[] } => ({
      label,
      spec: {
        metrics: [m],
        dimensions: [{ field: 'customer.name' }],
        filters: [],
        having: [],
        timeRange: p.time ?? { preset: 'all_time' },
        orderBy: { by: m, dir: p.rank ?? 'desc' },
        limit: p.topN ?? 10,
      },
      assumptions: [],
    });
    if (metric('net_sales')?.available && metric('order_count')?.available)
      return {
        confident: p.leftover.length === 0,
        leftover: p.leftover,
        interpretation: {
          kind: 'clarify',
          question:
            'Do you mean your best customers by how much they spend or how often they order?',
          options: [
            base('net_sales', 'How much they spend'),
            base('order_count', 'How often they order'),
          ],
        },
      };
  }

  if (metrics.length === 0) {
    const anything = p.dims.length || p.values.length || p.time || p.grain || p.rank;
    if (!anything) return null;
    metrics = ['net_sales'];
    assumptions.push(
      p.rank ? 'I took “best” to mean highest net sales.' : 'I looked at your net sales.',
    );
  }

  const unavailable = metrics.map(metric).find((m) => m && !m.available);
  if (unavailable)
    return {
      confident: true,
      leftover: p.leftover,
      interpretation: {
        kind: 'unanswerable',
        reason: 'missing_data',
        missing: [unavailable.label],
        message:
          unavailable.reason ??
          `I can’t work out ${unavailable.label.toLowerCase()} from your data yet.`,
      },
    };

  for (const m of p.metrics) {
    if (GENERIC_SALES.has(m.phrase) && m.id === 'net_sales')
      assumptions.push(
        `I took “${m.phrase}” to mean net sales: money from completed sales after discounts and refunds.`,
      );
    if (GENERIC_PROFIT.has(m.phrase) && m.id === 'gross_profit')
      assumptions.push(
        'I took “profit” to mean gross profit: net sales minus what the items cost you.',
      );
  }

  // Breakdowns.
  // "What share of customers come back?" counts customers; it isn't a list of them.
  const customerMeasure = CUSTOMER_MEASURES.has(metrics[0] ?? '');
  const splitWord = /\b(by|per|each|every|which|list|top|best|worst)\b/.test(
    question.toLowerCase(),
  );
  let dims: QuestionSpec['dimensions'] = p.dims
    .filter((f) => !(f === 'customer.name' && customerMeasure && !splitWord))
    .slice(0, 2)
    .map((field) => ({ field }));
  if (followUp && previous && dims.length === 0 && !p.grain)
    dims = previous.dimensions.filter((d) => 'field' in d);
  const primary = metrics[0]!;
  const having: QuestionSpec['having'] = [];
  const valueFields = new Set(p.values.map((v) => v.field));
  const want = (field: string) => {
    if (!dims.some((d) => 'field' in d && d.field === field) && !valueFields.has(field))
      dims.push({ field });
  };
  if (
    ['dead_stock_value', 'days_of_cover'].includes(primary) ||
    p.metrics.some((m) => /best seller/.test(m.phrase))
  )
    want('product.name');
  if (primary === 'lapsed_customers' || (p.who && /receivables$/.test(primary)))
    want('customer.name');
  if (
    primary === 'dead_stock_value' ||
    primary === 'lapsed_customers' ||
    /receivables$/.test(primary)
  ) {
    if (dims.length) having.push({ metric: primary, op: 'gt', value: 0 });
  }
  if (p.grain) dims = [{ time: p.grain }, ...dims].slice(0, 2);

  // Filters from recognised values ("on Etsy", "mugs").
  const filters: QuestionSpec['filters'] = [];
  const byField = new Map<string, string[]>();
  for (const v of p.values) byField.set(v.field, [...(byField.get(v.field) ?? []), v.value]);
  for (const [field, values] of byField) {
    filters.push({ field, op: values.length > 1 ? 'in' : 'eq', values });
    // "What about Etsy?" after "sales by channel": one channel, so no channel breakdown.
    if (values.length === 1) dims = dims.filter((d) => !('field' in d && d.field === field));
  }
  if (followUp && previous) {
    for (const f of previous.filters) if (!byField.has(f.field)) filters.push(f);
  }
  // "What did I spend on ads": narrow expenses to that type.
  const expenseDim = catalog.dimensions.find((d) => d.field === 'expense.category');
  if (primary === 'expenses_total' && expenseDim) {
    for (const m of p.metrics.filter((x) => x.id === 'expenses_total')) {
      const word = EXPENSE_ALIASES[m.phrase] ?? m.phrase;
      if (
        expenseDim.values.some((v) => v.toLowerCase().includes(word)) &&
        !['expenses', 'overheads', 'running costs', 'bills', 'spend on', 'spent on'].includes(
          m.phrase,
        )
      )
        filters.push({ field: 'expense.category', op: 'contains', values: [word] });
    }
  }

  // Time.
  const def = metric(primary);
  let timeRange: TimeRange =
    p.time ??
    (followUp && previous ? previous.timeRange : undefined) ??
    (def?.defaultTime ? { preset: def.defaultTime as TimePreset } : { preset: 'all_time' });
  let compareTo = p.compare;
  if (compareTo && dims.some((d) => 'time' in d)) compareTo = undefined;
  if (compareTo && 'preset' in timeRange && timeRange.preset === 'all_time') {
    timeRange = { preset: 'last_90_days' };
    assumptions.push('I compared the last 90 days with the 90 days before.');
  }
  if (!p.time && !(followUp && previous) && !def?.snapshot) {
    const period =
      'preset' in timeRange ? resolvePreset(timeRange.preset, catalog.calendar) : timeRange;
    assumptions.push(
      'preset' in timeRange && timeRange.preset === 'all_time'
        ? 'This covers all your records so far.'
        : `This covers ${periodLabel(period)}.`,
    );
  }

  // Ranking.
  const hasCategoryDim = dims.some((d) => 'field' in d);
  let orderBy: QuestionSpec['orderBy'];
  let limit: number | undefined;
  if (hasCategoryDim && !dims.some((d) => 'time' in d)) {
    const dir = primary === 'days_of_cover' ? 'asc' : (p.rank ?? 'desc');
    orderBy = { by: primary, dir };
    if (p.rank || p.topN || primary === 'days_of_cover') limit = p.topN ?? 10;
  }

  const spec: QuestionSpec = {
    metrics: metrics.slice(0, 4),
    dimensions: dims,
    filters,
    having,
    timeRange,
    ...(compareTo ? { compareTo } : {}),
    ...(orderBy ? { orderBy } : {}),
    ...(limit ? { limit } : {}),
  };
  return {
    // "What was my best month?": a ranking over something we don't break down by.
    confident: p.leftover.length === 0 && !(p.rank && !hasCategoryDim),
    leftover: p.leftover,
    interpretation: {
      kind: 'query',
      spec,
      assumptions: assumptions.map(sentence).slice(0, 5),
      ...(p.table ? { chart: 'table' as const } : {}),
    },
  };
}
