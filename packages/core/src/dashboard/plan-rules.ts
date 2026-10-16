import type { AskCatalog } from '../ask/catalog';
import type { ChartType, QuestionSpec } from '../ask/interpretation';
import { titleFor } from '../ask/interpretation';
import { interpretWithRules, mentionedTime } from '../ask/rules';
import type { TimeGrain } from '../semantic/query-spec';
import type { EditOp, EditPlan, Tile } from './model';

/**
 * The rule-based dashboard editor (Task G, rules first as in ADR-040). It reads the common requests:
 * add a chart of <question>, remove/rename/move a tile, show it as another chart, show it monthly.
 * It returns null when it doesn't recognise the request (the AI gets it), and asks which tile when
 * more than one fits.
 */

const FILLER = new Set(
  `the my a an this that these those chart charts graph graphs tile tiles table tables box card cards
  list number numbers kpi kpis one widget panel section from of on in for to dashboard please it`
    .split(/\s+/)
    .filter(Boolean),
);

const stem = (w: string) =>
  w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .map(stem);

const CHART_WORDS: [RegExp, ChartType][] = [
  [/\b(table|list)\b/, 'table'],
  [/\bline\b/, 'line'],
  [/\bstacked\b/, 'stacked_bar'],
  [/\bbar\b/, 'bar_horizontal'],
  [/\b(number|kpi|total|figure)\b/, 'kpi'],
];

const GRAINS: [RegExp, TimeGrain][] = [
  [/\b(daily|by day|per day|each day)\b/, 'day'],
  [/\b(weekly|by week|per week|each week)\b/, 'week'],
  [/\b(monthly|by month|per month|each month)\b/, 'month'],
  [/\b(quarterly|by quarter|per quarter)\b/, 'quarter'],
  [/\b(yearly|annually|by year|per year)\b/, 'year'],
];

const GRAIN_ANY = new RegExp(GRAINS.map(([re]) => re.source).join('|'), 'g');

export interface PlanContext {
  catalog: AskCatalog;
  /** Plain labels for measures and breakdowns (for titles). */
  labels: { metric: (id: string) => string; dimension: (ref: string) => string };
}

/** The tile title for a question: "Net sales by city" (no dates: tiles follow the dashboard). */
export function tileTitle(spec: QuestionSpec, ctx: PlanContext): string {
  const t = titleFor(spec, ctx.catalog.calendar, ctx.labels).split(' · ')[0]!;
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/** Which tiles a phrase like "the top customers table" means, best first (ties included). */
export function matchTiles(phrase: string, tiles: readonly Tile[], ctx: PlanContext): Tile[] {
  const want = new Set(words(phrase));
  if (want.size === 0) return [];
  const scored = tiles.map((t) => {
    const titleWords = new Set(words(t.title));
    const about = new Set([
      ...titleWords,
      ...t.spec.metrics.flatMap((m) => [
        ...words(ctx.labels.metric(m)),
        ...(ctx.catalog.metrics.find((x) => x.id === m)?.synonyms.flatMap(words) ?? []),
      ]),
      ...t.spec.dimensions.flatMap((d) =>
        'field' in d ? words(ctx.labels.dimension(d.field)) : [d.time],
      ),
    ]);
    let score = 0;
    for (const w of want) {
      if (titleWords.has(w)) score += 2;
      else if (about.has(w)) score += 1;
    }
    // An exact title is unambiguous.
    if (words(t.title).join(' ') === [...want].join(' ')) score += 10;
    return { t, score };
  });
  const best = Math.max(...scored.map((s) => s.score));
  if (best <= 0) return [];
  const top = scored.filter((s) => s.score === best).map((s) => s.t);
  // "the slow stock list" vs "the slow stock number": the chart word breaks a tie.
  const hint = CHART_WORDS.find(([re]) => re.test(phrase.toLowerCase()))?.[1];
  const byChart = hint
    ? top.filter((t) => (hint === 'bar_horizontal' ? /bar/.test(t.chart) : t.chart === hint))
    : [];
  return byChart.length ? byChart : top;
}

const plan = (ops: EditOp[], summary: string): EditPlan => ({ ops, summary });
const which = (matches: Tile[], verb: string): EditPlan => ({
  ops: [],
  summary: '',
  clarify: {
    question: `Which one do you want to ${verb}?`,
    options: matches.slice(0, 4).map((t) => t.title),
  },
});

/** One target tile, or a clarifying question, or null (not recognised). */
function target(
  phrase: string,
  tiles: readonly Tile[],
  ctx: PlanContext,
  verb: string,
): Tile | EditPlan | null {
  const m = matchTiles(phrase, tiles, ctx);
  if (m.length === 0) return null;
  if (m.length > 1) return which(m, verb);
  return m[0]!;
}

export function planWithRules(
  request: string,
  tiles: readonly Tile[],
  ctx: PlanContext,
): EditPlan | null {
  const r = request
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(please|can you|could you|would you)\s+/i, '')
    .replace(/\s+please$/i, '')
    .trim();
  const lower = r.toLowerCase().replace(/[“”"]/g, '"');

  // Remove.
  let m =
    /^(?:remove|delete|hide|get rid of|drop|take (?:off|away|out))\s+(.+?)(?:\s+(?:from|off) (?:the |my )?dashboard)?$/.exec(
      lower,
    );
  if (m) {
    const t = target(m[1]!, tiles, ctx, 'remove');
    if (!t || 'ops' in t) return t;
    return plan([{ op: 'remove_tile', tileId: t.id }], `Remove “${t.title}”`);
  }

  // Rename: keep the owner's own spelling of the new name.
  m = /^(?:rename|call)\s+(.+?)\s+(?:to|as)\s+"?(.+?)"?$/.exec(lower);
  if (m) {
    const t = target(m[1]!, tiles, ctx, 'rename');
    if (!t || 'ops' in t) return t;
    const start = r.length - m[2]!.length - (lower.endsWith('"') ? 1 : 0);
    const name = r.slice(start, start + m[2]!.length).trim();
    return plan(
      [{ op: 'update_tile', tileId: t.id, title: name }],
      `Rename “${t.title}” to “${name}”`,
    );
  }

  // Move.
  m =
    /^(?:move|put)\s+(.+?)\s+(?:to\s+|at\s+)?(?:the\s+)?(top|bottom|first|last|start|end)(?:\s+of (?:the |my )?dashboard)?$/.exec(
      lower,
    );
  if (m) {
    const t = target(m[1]!, tiles, ctx, 'move');
    if (!t || 'ops' in t) return t;
    const position = ['top', 'first', 'start'].includes(m[2]!) ? 'top' : 'bottom';
    return plan(
      [{ op: 'move_tile', tileId: t.id, position }],
      `Move “${t.title}” to the ${position}`,
    );
  }

  // Grain: "show sales over time monthly instead of weekly".
  const wanted = lower.replace(/\binstead of\b.*$/, '');
  const grain = GRAINS.find(([re]) => re.test(wanted));
  m = /^(?:show|make|change|switch|display|turn)\s+(.+)$/.exec(lower);
  // "Show me sales by month" is a question for Ask, not a change to a tile.
  if (m && grain && !/^(?:show|display)\s+(?:me\b|(?:a|an)\s)/.test(lower)) {
    const phrase = m[1]!
      .replace(/\binstead of\b.*$/, '')
      .replace(GRAIN_ANY, '')
      .replace(/\b(to|into|as)\s*$/, '');
    const timeTiles = tiles.filter((t) => t.spec.dimensions.some((d) => 'time' in d));
    const t = words(phrase).length
      ? target(phrase, timeTiles, ctx, 'change')
      : timeTiles.length === 1
        ? timeTiles[0]!
        : null;
    if (!t || 'ops' in t) return t;
    const spec: QuestionSpec = {
      ...t.spec,
      dimensions: t.spec.dimensions.map((d) => ('time' in d ? { time: grain[1] } : d)),
    };
    return plan(
      [{ op: 'update_tile', tileId: t.id, spec }],
      `Show “${t.title}” ${grainWord(grain[1])}`,
    );
  }

  // Chart type: "show top customers as a bar chart".
  m =
    /^(?:show|make|display|turn|change|switch)\s+(.+?)\s+(?:as|into|to|in)\s+(?:a\s+|an\s+)?(table|list|line(?: chart| graph)?|bar(?: chart| graph)?|stacked bars?(?: chart)?|number|kpi|pie(?: chart)?|chart|graph)$/.exec(
      lower,
    );
  if (m) {
    // No pie charts (hard to read); a bar chart shows the same thing.
    const chart = /pie/.test(m[2]!)
      ? 'bar_horizontal'
      : CHART_WORDS.find(([re]) => re.test(m![2]!))?.[1];
    if (!chart) return null;
    const t = target(m[1]!, tiles, ctx, 'change');
    if (!t || 'ops' in t) return t;
    return plan(
      [{ op: 'update_tile', tileId: t.id, chart }],
      `Show “${t.title}” as ${chartWord(chart)}`,
    );
  }

  // Add: "add a chart of sales by city".
  m = /^(?:add|create|include|put|i want|i'd like|give me|new|show me|show)\s+(.+)$/.exec(lower);
  if (m) {
    let what = m[1]!.replace(/\s+(?:to|on|onto)\s+(?:the |my )?dashboard$/, '');
    const noun =
      /^(?:a |an |the )?(?:new )?((?:line |bar |stacked )?(?:chart|graph|tile|table|number|kpi|card|list|total))(?:\s+(?:of|for|showing|with|on|about))?\s+/.exec(
        what,
      );
    const chart = noun ? CHART_WORDS.find(([re]) => re.test(noun[1]!))?.[1] : undefined;
    if (noun) what = what.slice(noun[0].length);
    else if (/^(?:show|show me)\b/.test(lower)) return null; // "show me sales": a question, not an edit
    const rules = interpretWithRules(what, ctx.catalog);
    if (!rules?.confident || rules.interpretation.kind !== 'query') return null;
    const spec = rules.interpretation.spec;
    const fixedDates = Boolean(mentionedTime(what, ctx.catalog));
    const title = tileTitle(spec, ctx);
    return plan(
      [
        {
          op: 'add_tile',
          title,
          spec,
          // A number only makes sense without a breakdown; otherwise the shape decides.
          ...(chart && (chart !== 'kpi' || spec.dimensions.length === 0) ? { chart } : {}),
          position: 'top',
          fixedDates,
        },
      ],
      `Add “${title}”`,
    );
  }
  return null;
}

const grainWord = (g: TimeGrain) =>
  ({ day: 'by day', week: 'by week', month: 'by month', quarter: 'by quarter', year: 'by year' })[
    g
  ];
const chartWord = (c: ChartType) =>
  ({
    kpi: 'a number',
    line: 'a line chart',
    bar: 'a bar chart',
    bar_horizontal: 'a bar chart',
    stacked_bar: 'stacked bars',
    table: 'a table',
  })[c];
