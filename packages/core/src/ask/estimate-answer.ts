import type { AnswerKind } from '@bizr/db';

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

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const day = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const NOT_A_PROMISE = 'These are estimates from your own sales history, not promises.';

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
  const style = { locale: localeFor(member.settings), currency: member.settings.currency };
  const h = await dailyHistory(member, req.metric);
  const label = ctx.catalog.metrics.find((m) => m.id === req.metric)?.label ?? h.label;
  const title = `${label} estimate · ${req.label}`;
  const ahead = Math.max(1, daysBetween(h.today, req.period.to));
  const f = forecastDaily(h.history, { from: h.today, days: ahead });
  if (!f)
    return {
      kind: 'estimate',
      content: {
        title,
        headline: [
          { text: 'We need at least two weeks of sales before we can estimate what’s coming.' },
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

  const headline: Segment[] = [
    { text: 'About ' },
    fact(fmt(total), 'estimate'),
    { text: ` for ${req.label}, likely between ` },
    fact(fmt(low), 'low'),
    { text: ' and ' },
    fact(fmt(high), 'high'),
    { text: '.' },
  ];
  if (already > 0)
    headline.push(
      { text: ' That includes ' },
      fact(
        formatExact(
          h.format === 'money' ? already.toFixed(2) : Math.round(already),
          h.format,
          style,
        ),
        'so_far',
      ),
      { text: ' already recorded.' },
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
          ? WEEKDAY.format(new Date(`${part[0]!.date}T00:00:00Z`))
          : `${day(part[0]!.date)} – ${day(part.at(-1)!.date)}`,
      m0: h.format === 'money' ? v.toFixed(2) : v,
    });
  }
  const data: AnswerData = {
    columns: [
      { key: 'd0', label: chunk === 1 ? 'Day' : 'Week', kind: 'dimension' },
      {
        key: 'm0',
        label: `Estimated ${label.toLowerCase()}`,
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
    `Took your daily ${label.toLowerCase()} for the last ${f.historyDays} days, up to yesterday.`,
    f.basis === 'last_year'
      ? 'Took the same weeks last year, and scaled them by how your last 4 weeks compare with the same weeks a year before.'
      : f.basis === 'year_pattern'
        ? 'Used your usual level for each month and each weekday over the last year, and your level over the last 4 weeks.'
        : 'Carried your last 4 weeks forward, with your usual pattern across the week.',
    ...(already > 0 ? ['Added what’s already recorded for this period, up to yesterday.'] : []),
    `The range (about ±${pct}%) is how far this way of estimating was off on your last few months.`,
  ];
  return {
    kind: 'estimate',
    content: {
      title,
      headline,
      data,
      chart: rows.length > 1 ? 'bar' : 'table',
      steps,
      assumptions: [...f.notes.map((n) => noteText(n, style.locale)), NOT_A_PROMISE],
    },
  };
}

async function goalAnswer(
  member: MemberWorkspace,
  ctx: AskContext,
  metric: string | null,
): Promise<RenderedEstimate> {
  const style = { locale: localeFor(member.settings), currency: member.settings.currency };
  const all = await goalProgress(member);
  const goals = metric ? all.filter((g) => g.metric.id === metric) : all;
  if (goals.length === 0) {
    const what = metric
      ? ` for ${(ctx.catalog.metrics.find((m) => m.id === metric)?.label ?? metric).toLowerCase()}`
      : '';
    return {
      kind: 'estimate',
      content: {
        title: 'Monthly goals',
        headline: [
          { text: `You haven’t set a monthly goal${what} yet. You can set one on Plan ahead.` },
        ],
        assumptions: [],
      },
    };
  }
  const headline: Segment[] = [];
  for (const g of goals) {
    const l = goalLines(g, style);
    if (headline.length) headline.push({ text: ' ' });
    headline.push(
      fact(`${g.metric.label}: ${STATUS_LABEL[g.status].toLowerCase()}.`, `status_${g.metric.id}`),
      { text: ` ${[l.soFar, l.heading, l.need].filter(Boolean).join(' ')}` },
    );
  }
  return {
    kind: 'estimate',
    content: {
      title:
        goals.length === 1
          ? `Goal · ${goals[0]!.metric.label} · ${goals[0]!.month.label}`
          : `Goals · ${goals[0]!.month.label}`,
      headline,
      steps: [
        'So far: this month up to now, the same measure as everywhere else in the app.',
        'Heading for: what was recorded up to yesterday, plus the estimate for the rest of the month.',
      ],
      assumptions: [
        ...[...new Set(goals.flatMap((g) => g.notes.map((n) => noteText(n, style.locale))))],
        NOT_A_PROMISE,
      ],
    },
  };
}

async function reorderAnswer(member: MemberWorkspace): Promise<RenderedEstimate> {
  const list = await reorderList(member);
  if (!list.available)
    return {
      kind: 'unanswerable',
      content: {
        title: 'What to reorder',
        assumptions: [],
        unanswerable: {
          reason: 'missing_data',
          message: 'To tell you what to reorder, we need a stock list and your sales.',
          missing: ['stock counts'],
        },
      },
    };
  const soon = list.lines.filter((l) => l.soon).length;
  const top = list.lines.slice(0, 20);
  return {
    kind: 'estimate',
    content: {
      title: 'What to reorder',
      headline:
        list.lines.length === 0
          ? [{ text: 'Nothing needs ordering right now.' }]
          : [
              fact(String(list.lines.length), 'products'),
              { text: ` ${list.lines.length === 1 ? 'product needs' : 'products need'} ordering` },
              ...(soon
                ? [
                    { text: ', and ' },
                    fact(String(soon), 'soon'),
                    { text: ` may run out before a new order arrives.` },
                  ]
                : [{ text: '.' }]),
            ],
      ...(top.length
        ? {
            data: {
              columns: [
                { key: 'd0', label: 'Product', kind: 'dimension' as const },
                { key: 'd1', label: 'Supplier', kind: 'dimension' as const },
                {
                  key: 'm0',
                  label: 'Days of stock left',
                  kind: 'metric' as const,
                  format: 'days' as const,
                  metric: list.coverMeasure,
                },
                {
                  key: 'm1',
                  label: 'Order about',
                  kind: 'metric' as const,
                  format: 'number' as const,
                  metric: 'suggested_order',
                },
              ],
              rows: top.map((l) => ({
                d0: l.product,
                d1: l.supplier ?? 'No supplier recorded',
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
        'Took each product’s stock from your latest count, and how many sold a day over the last 4 weeks.',
        'Listed the ones whose stock won’t last the supplier’s lead time plus 30 days (14 days when no lead time is recorded).',
        'Suggested enough to cover that time, allowing for your usual sales in those weeks.',
      ],
      assumptions: [
        ...(list.seasonNote
          ? [`${noteText(list.seasonNote, localeFor(member.settings))} The amounts allow for it.`]
          : []),
        ...(list.perProductSeasons
          ? [
              'Each product’s own season from last year is allowed for, so seasonal stock shows up before its season.',
            ]
          : []),
        'The full list, by supplier and with downloads, is on Plan ahead → What to reorder.',
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
      return reorderAnswer(member);
    case 'not_estimable': {
      const { forecasts } = planningMetrics(member.workspace.packId);
      const names = forecasts
        .map((id) => ctx.catalog.metrics.find((m) => m.id === id)?.label.toLowerCase() ?? id)
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1');
      const what = ctx.catalog.metrics.find((m) => m.id === req.metric)?.label ?? req.metric;
      return {
        kind: 'unanswerable',
        content: {
          title: what,
          assumptions: [],
          unanswerable: {
            reason: 'out_of_scope',
            message: `I can estimate ${names} ahead, but not ${what.toLowerCase()} yet. I can show you how it has gone so far.`,
            missing: [],
          },
        },
      };
    }
  }
}
