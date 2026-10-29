import type { AnswerKind } from '@bizr/db';
import { translator, type Language, type Translator } from '@bizr/i18n';

import type { Segment } from '../narration';
import { forecastDaily } from '../planning/forecast';
import { goalProgress } from '../planning/goals';
import { reorderList } from '../planning/reorder';
import { dailyHistory, planningMetrics } from '../planning/service';
import {
  formatEstimate,
  formatExact,
  goalLines,
  noteText,
  roundEstimate,
  STATUS_LABEL,
} from '../planning/text';
import type { MemberWorkspace } from '../workspaces/service';
import type { AnswerData } from './answer';
import type { AskContext } from './catalog';
import type { EstimateRequest } from './estimate';
import type { AnswerContent } from './service';
import { localeFor } from './view';

/**
 * Answers about what's ahead (M12, ADR-061). Every number comes from the planning engine (estimates,
 * rounded and said with "about") or from an executed query (what's already sold); the AI writes
 * none of them. The steps say how it was worked out; the assumptions say what it took for granted.
 */

const dateLocale = (lang: Language) => (lang === 'es' ? 'es-ES' : 'en-GB');
const shortDay = (iso: string, lang: Language) =>
  new Intl.DateTimeFormat(dateLocale(lang), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
const weekday = (iso: string, lang: Language) =>
  new Intl.DateTimeFormat(dateLocale(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const notAPromise = (t: Translator) =>
  t('These are estimates from your own sales history, not promises.');

/**
 * A translated sentence as segments, with each `{name}` placeholder replaced by its fact segment
 * (so the numbers stay code's, and bold where the screen shows them so).
 */
function sentence(text: string, facts: Record<string, Segment>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{([a-z_]+)\}/g)) {
    const f = facts[m[1]!];
    if (!f) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push(f);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
const KEEP = (name: string) => `{${name}}`;

export interface RenderedEstimate {
  kind: AnswerKind;
  content: AnswerContent;
}

function fact(text: string, name: string): Segment {
  return { text, fact: name };
}

async function forecastAnswer(
  member: MemberWorkspace,
  ctx: AskContext,
  req: Extract<EstimateRequest, { kind: 'forecast' }>,
): Promise<RenderedEstimate> {
  const lang = ctx.catalog.lang ?? 'en';
  const t = translator(lang);
  const style = { locale: localeFor(member.settings, lang), currency: member.settings.currency };
  const h = await dailyHistory(member, req.metric);
  const label = ctx.catalog.metrics.find((m) => m.id === req.metric)?.label ?? h.label;
  const title = t('{label} estimate · {period}', { label, period: req.label });
  const ahead = Math.max(1, daysBetween(h.today, req.period.to));
  const f = forecastDaily(h.history, { from: h.today, days: ahead });
  if (!f)
    return {
      kind: 'estimate',
      content: {
        title,
        headline: [
          {
            text: t('We need at least two weeks of sales before we can estimate what’s coming.'),
          },
        ],
        assumptions: [],
      },
    };
  const inPeriod = f.days.filter((d) => d.date >= req.period.from && d.date < req.period.to);
  const estimate = inPeriod.reduce((a, d) => a + d.estimate, 0);
  const already = h.history
    .filter((d) => d.date >= req.period.from && d.date < h.today)
    .reduce((a, d) => a + d.value, 0);
  const total = already + estimate;
  const low = already + estimate * (1 - f.error);
  const high = already + estimate * (1 + f.error);
  const fmt = (n: number) => formatEstimate(n, h.format, style);

  const headline: Segment[] = sentence(
    t('About {estimate} for {period}, likely between {low} and {high}.', {
      estimate: KEEP('estimate'),
      period: req.label,
      low: KEEP('low'),
      high: KEEP('high'),
    }),
    {
      estimate: fact(fmt(total), 'estimate'),
      low: fact(fmt(low), 'low'),
      high: fact(fmt(high), 'high'),
    },
  );
  if (already > 0)
    headline.push(
      { text: ' ' },
      ...sentence(t('That includes {so_far} already recorded.', { so_far: KEEP('so_far') }), {
        so_far: fact(
          formatExact(
            h.format === 'money' ? already.toFixed(2) : Math.round(already),
            h.format,
            style,
          ),
          'so_far',
        ),
      }),
    );

  // Week by week (day by day for a week or less), estimates only.
  const chunk = inPeriod.length <= 7 ? 1 : 7;
  const rows: AnswerData['rows'] = [];
  for (let i = 0; i < inPeriod.length; i += chunk) {
    const part = inPeriod.slice(i, i + chunk);
    const v = roundEstimate(part.reduce((a, d) => a + d.estimate, 0));
    rows.push({
      d0:
        chunk === 1
          ? weekday(part[0]!.date, lang)
          : `${shortDay(part[0]!.date, lang)} – ${shortDay(part.at(-1)!.date, lang)}`,
      m0: h.format === 'money' ? v.toFixed(2) : v,
    });
  }
  const data: AnswerData = {
    columns: [
      { key: 'd0', label: chunk === 1 ? t('Day') : t('Week'), kind: 'dimension' },
      {
        key: 'm0',
        label: t('Estimated {measure}', { measure: label.toLowerCase() }),
        kind: 'metric',
        format: h.format,
        metric: req.metric,
      },
    ],
    rows,
    totalRows: rows.length,
    truncated: false,
  };
  const pct = Math.round(f.error * 100);
  const steps = [
    t('Took your daily {measure} for the last {days} days, up to yesterday.', {
      measure: label.toLowerCase(),
      days: f.historyDays,
    }),
    f.basis === 'last_year'
      ? t(
          'Took the same weeks last year, and scaled them by how your last 4 weeks compare with the same weeks a year before.',
        )
      : f.basis === 'year_pattern'
        ? t(
            'Used your usual level for each month and each weekday over the last year, and your level over the last 4 weeks.',
          )
        : t('Carried your last 4 weeks forward, with your usual pattern across the week.'),
    ...(already > 0 ? [t('Added what’s already recorded for this period, up to yesterday.')] : []),
    t(
      'The range (about ±{pct}%) is how far this way of estimating was off on your last few months.',
      {
        pct,
      },
    ),
  ];
  return {
    kind: 'estimate',
    content: {
      title,
      headline,
      data,
      chart: rows.length > 1 ? 'bar' : 'table',
      steps,
      assumptions: [...f.notes.map((n) => t.text(noteText(n, style.locale))), notAPromise(t)],
    },
  };
}

async function goalAnswer(
  member: MemberWorkspace,
  ctx: AskContext,
  metric: string | null,
): Promise<RenderedEstimate> {
  const lang = ctx.catalog.lang ?? 'en';
  const t = translator(lang);
  const style = { locale: localeFor(member.settings, lang), currency: member.settings.currency };
  const all = await goalProgress(member);
  const goals = metric ? all.filter((g) => g.metric.id === metric) : all;
  const labelOf = (id: string, fallback: string) =>
    ctx.catalog.metrics.find((m) => m.id === id)?.label ?? fallback;
  if (goals.length === 0) {
    const text = metric
      ? t('You haven’t set a monthly goal for {measure} yet. You can set one on Plan ahead.', {
          measure: labelOf(metric, metric).toLowerCase(),
        })
      : t('You haven’t set a monthly goal yet. You can set one on Plan ahead.');
    return {
      kind: 'estimate',
      content: { title: t('Monthly goals'), headline: [{ text }], assumptions: [] },
    };
  }
  const headline: Segment[] = [];
  for (const g of goals) {
    const l = goalLines(g, style);
    if (headline.length) headline.push({ text: ' ' });
    headline.push(
      fact(
        `${labelOf(g.metric.id, g.metric.label)}: ${t.text(STATUS_LABEL[g.status]).toLowerCase()}.`,
        `status_${g.metric.id}`,
      ),
      {
        text: ` ${[l.soFar, l.heading, l.need]
          .filter((x): x is string => Boolean(x))
          .map((x) => t.text(x))
          .join(' ')}`,
      },
    );
  }
  return {
    kind: 'estimate',
    content: {
      title:
        goals.length === 1
          ? t('Goal · {measure} · {month}', {
              measure: labelOf(goals[0]!.metric.id, goals[0]!.metric.label),
              month: t.text(goals[0]!.month.label),
            })
          : t('Goals · {month}', { month: t.text(goals[0]!.month.label) }),
      headline,
      steps: [
        t('So far: this month up to now, the same measure as everywhere else in the app.'),
        t(
          'Heading for: what was recorded up to yesterday, plus the estimate for the rest of the month.',
        ),
      ],
      assumptions: [
        ...[
          ...new Set(goals.flatMap((g) => g.notes.map((n) => t.text(noteText(n, style.locale))))),
        ],
        notAPromise(t),
      ],
    },
  };
}

async function reorderAnswer(member: MemberWorkspace, lang: Language): Promise<RenderedEstimate> {
  const t = translator(lang);
  const list = await reorderList(member);
  if (!list.available)
    return {
      kind: 'unanswerable',
      content: {
        title: t('What to reorder'),
        assumptions: [],
        unanswerable: {
          reason: 'missing_data',
          message: t('To tell you what to reorder, we need a stock list and your sales.'),
          missing: [t('stock counts')],
        },
      },
    };
  const soon = list.lines.filter((l) => l.soon).length;
  const top = list.lines.slice(0, 20);
  return {
    kind: 'estimate',
    content: {
      title: t('What to reorder'),
      headline:
        list.lines.length === 0
          ? [{ text: t('Nothing needs ordering right now.') }]
          : sentence(
              soon
                ? t.plural(
                    list.lines.length,
                    '{products} product needs ordering, and {soon} may run out before a new order arrives.',
                    '{products} products need ordering, and {soon} may run out before a new order arrives.',
                    { products: KEEP('products'), soon: KEEP('soon') },
                  )
                : t.plural(
                    list.lines.length,
                    '{products} product needs ordering.',
                    '{products} products need ordering.',
                    { products: KEEP('products') },
                  ),
              {
                products: fact(String(list.lines.length), 'products'),
                soon: fact(String(soon), 'soon'),
              },
            ),
      ...(top.length
        ? {
            data: {
              columns: [
                { key: 'd0', label: t('Product'), kind: 'dimension' as const },
                { key: 'd1', label: t('Supplier'), kind: 'dimension' as const },
                {
                  key: 'm0',
                  label: t('Days of stock left'),
                  kind: 'metric' as const,
                  format: 'days' as const,
                  metric: list.coverMeasure,
                },
                {
                  key: 'm1',
                  label: t('Order about'),
                  kind: 'metric' as const,
                  format: 'number' as const,
                  metric: 'suggested_order',
                },
              ],
              rows: top.map((l) => ({
                d0: l.product,
                d1: l.supplier ?? t('No supplier recorded'),
                m0: Math.round(l.daysOfCover),
                m1: l.suggested,
              })),
              totalRows: list.lines.length,
              truncated: list.lines.length > top.length,
            },
            chart: 'table' as const,
          }
        : {}),
      steps: [
        t(
          'Took each product’s stock from your latest count, and how many sold a day over the last 4 weeks.',
        ),
        t(
          'Listed the ones whose stock won’t last the supplier’s lead time plus 30 days (14 days when no lead time is recorded).',
        ),
        t('Suggested enough to cover that time, allowing for your usual sales in those weeks.'),
      ],
      assumptions: [
        ...(list.seasonNote
          ? [
              `${t.text(noteText(list.seasonNote, localeFor(member.settings, lang)))} ${t('The amounts allow for it.')}`,
            ]
          : []),
        ...(list.perProductSeasons
          ? [
              t(
                'Each product’s own season from last year is allowed for, so seasonal stock shows up before its season.',
              ),
            ]
          : []),
        t('The full list, by supplier and with downloads, is on Plan ahead → What to reorder.'),
      ],
    },
  };
}

/** The answer for a question recognised as being about what's ahead. */
export async function renderEstimate(
  member: MemberWorkspace,
  ctx: AskContext,
  req: EstimateRequest,
): Promise<RenderedEstimate> {
  switch (req.kind) {
    case 'forecast':
      return forecastAnswer(member, ctx, req);
    case 'goal':
      return goalAnswer(member, ctx, req.metric);
    case 'reorder':
      return reorderAnswer(member, ctx.catalog.lang ?? 'en');
    case 'not_estimable': {
      const { forecasts } = planningMetrics(member.workspace.packId);
      const t = translator(ctx.catalog.lang ?? 'en');
      const names = forecasts
        .map((id) => ctx.catalog.metrics.find((m) => m.id === id)?.label.toLowerCase() ?? id)
        .join(', ')
        .replace(/, ([^,]*)$/, ` ${t('and')} $1`);
      const what = ctx.catalog.metrics.find((m) => m.id === req.metric)?.label ?? req.metric;
      return {
        kind: 'unanswerable',
        content: {
          title: what,
          assumptions: [],
          unanswerable: {
            reason: 'out_of_scope',
            message: t(
              'I can estimate {names} ahead, but not {what} yet. I can show you how it has gone so far.',
              { names, what: what.toLowerCase() },
            ),
            missing: [],
          },
        },
      };
    }
  }
}
