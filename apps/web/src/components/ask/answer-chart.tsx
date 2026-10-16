'use client';

import type { ChartType, KpiView, TableView } from '@bizr/core/ask';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NumberStyle {
  locale: string;
  currency: string;
}

const COLORS = [
  'oklch(0.55 0.15 250)',
  'oklch(0.65 0.15 150)',
  'oklch(0.7 0.15 70)',
  'oklch(0.6 0.18 20)',
  'oklch(0.55 0.12 300)',
  'oklch(0.6 0.05 200)',
];
const TABLE_PREVIEW = 15;

/** Short axis labels ("$12K", "40%"). Exact values are in the tooltip and the table. */
function tickFormatter(format: string | undefined, style: NumberStyle) {
  const compact = new Intl.NumberFormat(style.locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
    ...(format === 'money' ? { style: 'currency', currency: style.currency } : {}),
    ...(format === 'percent' ? { style: 'percent' } : {}),
  });
  return (v: number) => compact.format(v);
}

interface Point {
  label: string;
  [series: string]: string | number | null;
}

/** Rows → chart points. Values are for plotting only; tooltips show the exact text from the table. */
function points(table: TableView) {
  const metrics = table.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'metric');
  const data: Point[] = table.rows.map((r) => {
    const p: Point = { label: r.label };
    for (const { c, i } of metrics) {
      p[c.key] = r.cells[i]!.value;
      p[`${c.key}__text`] = r.cells[i]!.text;
    }
    return p;
  });
  return { data, metrics: metrics.map((m) => m.c) };
}

function ExactTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; name?: string; color?: string; payload?: Point }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <strong>{String(p.payload?.[`${String(p.dataKey)}__text`] ?? '')}</strong>
        </p>
      ))}
    </div>
  );
}

/**
 * Headline numbers. `compact` is for dashboard tiles: no inner cards, the label only when it says
 * more than the tile title, and the comparison dates in a tooltip.
 */
export function KpiCards({
  kpis,
  comparedWith,
  compact,
  title,
}: {
  kpis: KpiView[];
  comparedWith?: string;
  compact?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        compact ? 'grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]' : 'sm:grid-cols-2',
      )}
    >
      {kpis.map((k) => (
        <div key={k.label} className={cn('min-w-0', !compact && 'rounded-lg border p-4')}>
          {!(compact && kpis.length === 1 && k.label.toLowerCase() === title?.toLowerCase()) && (
            <p className="text-sm text-muted-foreground">{k.label}</p>
          )}
          <p className={cn('mt-1 font-semibold tabular-nums', compact ? 'text-2xl' : 'text-3xl')}>
            {k.text}
          </p>
          {k.change && (
            <p
              className={cn(
                'mt-1 flex flex-wrap items-center gap-1 text-sm',
                k.change.good === true && 'text-emerald-700',
                k.change.good === false && 'text-destructive',
                k.change.good === undefined && 'text-muted-foreground',
              )}
              {...(compact && comparedWith ? { title: `Compared with ${comparedWith}` } : {})}
            >
              {k.change.direction === 'up' ? (
                <ArrowUp className="size-4" aria-label="Up" />
              ) : k.change.direction === 'down' ? (
                <ArrowDown className="size-4" aria-label="Down" />
              ) : (
                <Minus className="size-4" aria-hidden />
              )}
              {k.change.text}
              {comparedWith && (
                <span className="text-muted-foreground">
                  {compact ? 'vs the period before' : `vs ${comparedWith}`}
                </span>
              )}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function AnswerTable({ table, caption }: { table: TableView; caption: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, TABLE_PREVIEW);
  const more = table.totalRows > rows.length;
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('px-3 py-2 font-medium', c.kind === 'metric' && 'text-right')}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                {r.cells.map((cell, i) => (
                  <td
                    key={table.columns[i]!.key}
                    className={cn(
                      'px-3 py-2',
                      table.columns[i]!.kind === 'metric' && 'text-right tabular-nums',
                    )}
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Showing the top {rows.length} of {table.totalRows}.
          {table.rows.length > rows.length && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setAll(true)}>
              See all
            </Button>
          )}
        </p>
      )}
    </div>
  );
}

/** The chart for an answer. `table` is always available as the accessible alternative. */
export function AnswerChart({
  chart,
  table,
  title,
  style,
}: {
  chart: ChartType;
  table: TableView;
  title: string;
  style: NumberStyle;
}) {
  const { data, metrics } = useMemo(() => points(table), [table]);
  const stack = useMemo(() => stacked(table), [table]);
  const first = metrics[0];
  const tick = tickFormatter(first?.format, style);

  if (chart === 'table' || chart === 'kpi' || !first)
    return <AnswerTable table={table} caption={title} />;

  const common = { data, margin: { top: 8, right: 16, bottom: 8, left: 8 } };
  const height = chart === 'bar_horizontal' ? Math.max(160, data.length * 36 + 40) : 280;
  return (
    <figure className="grid gap-2">
      <div role="img" aria-label={`Chart: ${title}. The same figures are in the table view.`}>
        <ResponsiveContainer width="100%" height={height}>
          {chart === 'line' ? (
            <LineChart {...common}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={16} />
              <YAxis tickFormatter={tick} tick={{ fontSize: 12 }} width={64} />
              <Tooltip content={<ExactTooltip />} />
              {metrics.length > 1 && <Legend />}
              {metrics.map((m, i) => (
                <Line
                  isAnimationActive={false}
                  key={m.key}
                  dataKey={m.key}
                  name={m.label}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={data.length <= 31}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : chart === 'stacked_bar' ? (
            <BarChart {...common} data={stack.data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={tick} tick={{ fontSize: 12 }} width={64} />
              <Tooltip content={<ExactTooltip />} />
              <Legend />
              {stack.groups.map((g, i) => (
                <Bar
                  isAnimationActive={false}
                  key={g}
                  dataKey={g}
                  name={g}
                  stackId="a"
                  fill={COLORS[i % COLORS.length]}
                />
              ))}
            </BarChart>
          ) : chart === 'bar_horizontal' ? (
            <BarChart {...common} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={tick} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 12 }} />
              <Tooltip content={<ExactTooltip />} />
              <Bar
                isAnimationActive={false}
                dataKey={first.key}
                name={first.label}
                fill={COLORS[0]}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          ) : (
            <BarChart {...common}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={tick} tick={{ fontSize: 12 }} width={64} />
              <Tooltip content={<ExactTooltip />} />
              {metrics.map((m, i) => (
                <Bar
                  isAnimationActive={false}
                  key={m.key}
                  dataKey={m.key}
                  name={m.label}
                  fill={COLORS[i % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Time × category, one measure: one stacked bar per period. */
function stacked(table: TableView) {
  const series = table.series;
  const metric = table.columns.findIndex((c) => c.kind === 'metric');
  if (!series || metric < 0) return { data: [], groups: [] };
  const groups = [...new Set(table.rows.map((r) => r.cells[series.group]!.text))];
  const byX = new Map<string, Point>();
  for (const r of table.rows) {
    const x = r.cells[series.x]!.text;
    const g = r.cells[series.group]!.text;
    const p = byX.get(x) ?? { label: x };
    p[g] = r.cells[metric]!.value;
    p[`${g}__text`] = r.cells[metric]!.text;
    byX.set(x, p);
  }
  return { data: [...byX.values()], groups };
}
