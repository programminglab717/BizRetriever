import { localeFor } from '@bizr/core/ask';
import {
  estimateMetric,
  formatEstimate,
  goalProgress,
  listGoals,
  noteText,
  planningMetrics,
  reorderList,
} from '@bizr/core/planning';
import { loadSemanticModel } from '@bizr/core/semantic';
import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { GoalEditor } from '@/components/plan/goal-editor';
import { GoalProgressView } from '@/components/plan/goal-progress';
import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

const HORIZON = 28;
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const day = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/** Plan ahead (M11): the next four weeks, monthly goals, and what to reorder. */
export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const style = { locale: localeFor(member.settings), currency: member.settings.currency };
  const { forecasts, goals: goalMetrics } = planningMetrics(member.workspace.packId);
  const model = await loadSemanticModel(member.workspace);
  const headline = forecasts.find((m) => model.metrics.has(m));
  if (!headline)
    return (
      <div className="grid gap-6">
        <PageHeader title="Plan ahead" />
        <ComingSoon title="Bring in your sales to plan ahead">
          <p>With your sales we can estimate the weeks ahead and track a monthly goal.</p>
          <div className="mt-3">
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/data/import`}>Upload files</Link>
            </Button>
          </div>
        </ComingSoon>
      </div>
    );

  const [estimate, progress, saved, reorder] = await Promise.all([
    estimateMetric(member, headline, { days: HORIZON, model }),
    goalProgress(member),
    listGoals(member),
    reorderList(member),
  ]);
  const f = estimate.forecast;
  const weeks = f
    ? Array.from({ length: Math.ceil(f.days.length / 7) }, (_, w) => {
        const days = f.days.slice(w * 7, w * 7 + 7);
        return {
          label: `${day(days[0]!.date)} – ${day(days.at(-1)!.date)}`,
          total: days.reduce((a, d) => a + d.estimate, 0),
        };
      })
    : [];
  const biggest = Math.max(1, ...weeks.map((w) => w.total));
  const soon = reorder.lines.filter((l) => l.soon).length;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Plan ahead"
        description="Estimates from your own sales history: what the next weeks usually bring, how this month is going, and what to order."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {estimate.metric.label}: the next {HORIZON / 7} weeks
          </CardTitle>
          {f ? (
            <CardDescription data-testid="estimate-headline">
              About <strong>{formatEstimate(f.total, estimate.metric.format, style)}</strong>,
              likely between {formatEstimate(f.low, estimate.metric.format, style)} and{' '}
              {formatEstimate(f.high, estimate.metric.format, style)}.
            </CardDescription>
          ) : (
            <CardDescription>
              We need at least two weeks of sales to estimate what’s coming.
            </CardDescription>
          )}
        </CardHeader>
        {f && (
          <CardContent className="grid gap-4">
            <table className="w-full text-sm">
              <caption className="sr-only">Estimate by week</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Week</th>
                  <th scope="col">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.label}>
                    <th
                      scope="row"
                      className="w-36 py-1 text-left font-normal text-muted-foreground"
                    >
                      {w.label}
                    </th>
                    <td className="py-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 rounded bg-primary/70"
                          style={{ width: `${Math.max(4, (w.total / biggest) * 70)}%` }}
                          aria-hidden
                        />
                        <span className="tabular-nums">
                          about {formatEstimate(w.total, estimate.metric.format, style)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="grid gap-1 text-sm text-muted-foreground" aria-label="What this assumes">
              {f.notes.map((n) => (
                <li key={n.kind}>{noteText(n, style.locale)}</li>
              ))}
              <li>
                The range is how far the same method was off on your last few months. These are
                estimates, not promises.
              </li>
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly goals</CardTitle>
          <CardDescription>
            Set a goal and we’ll show how the month is going and where it’s heading.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {goalMetrics
            .filter((m) => model.metrics.has(m))
            .map((m) => {
              const g = progress.find((p) => p.metric.id === m);
              const label = model.metrics.get(m)?.label ?? m;
              return (
                <div key={m} className="grid gap-3 border-b pb-6 last:border-b-0 last:pb-0">
                  {g ? (
                    <GoalProgressView goal={g} style={style} />
                  ) : (
                    <h3 className="font-semibold">{label}</h3>
                  )}
                  <GoalEditor
                    slug={slug}
                    metricKey={m}
                    label={label}
                    current={saved.find((s) => s.metricKey === m)?.target ?? null}
                    money={model.metrics.get(m)?.format === 'money'}
                  />
                </div>
              );
            })}
        </CardContent>
      </Card>

      {reorder.available && (
        <Link
          href={`/w/${slug}/plan/reorder` as Route}
          className="flex items-center justify-between rounded-xl border p-4 hover:bg-muted/50"
          data-testid="reorder-link"
        >
          <span className="grid gap-0.5">
            <span className="font-semibold">What to reorder</span>
            <span className="text-sm text-muted-foreground">
              {reorder.lines.length === 0
                ? 'Nothing needs ordering right now.'
                : `${reorder.lines.length} ${reorder.lines.length === 1 ? 'product' : 'products'} to order${soon ? `, ${soon} may run out before a new order arrives` : ''}.`}
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      )}
    </div>
  );
}
