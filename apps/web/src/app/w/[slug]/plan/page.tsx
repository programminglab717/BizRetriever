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
import { canChange } from '@bizr/core/workspaces';
import { ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { GoalEditor } from '@/components/plan/goal-editor';
import { GoalProgressView } from '@/components/plan/goal-progress';
import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

const HORIZON = 28;
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const day = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/** Plan ahead (M11): the next four weeks, monthly goals, and what to reorder. */
export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const style = { locale: localeFor(member.settings, t.lang), currency: member.settings.currency };
  const editor = canChange(member.role);
  const { forecasts, goals: goalMetrics } = planningMetrics(member.workspace.packId);
  const model = await loadSemanticModel(member.workspace);
  const headline = forecasts.find((m) => model.metrics.has(m));
  if (!headline)
    return (
      <div className="grid gap-6">
        <PageHeader title={t('Plan ahead')} />
        <ComingSoon title={t('Bring in your sales to plan ahead')}>
          <p>{t('With your sales we can estimate the weeks ahead and track a monthly goal.')}</p>
          <div className="mt-3">
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/data/import`}>{t('Upload files')}</Link>
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
  // The total in bold inside a whole translated sentence.
  const [aboutBefore = '', aboutAfter = ''] = f
    ? t('About {total}, likely between {low} and {high}.', {
        low: formatEstimate(f.low, estimate.metric.format, style),
        high: formatEstimate(f.high, estimate.metric.format, style),
      }).split('{total}')
    : [];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t('Plan ahead')}
        description={t(
          'Estimates from your own sales history: what the next weeks usually bring, how this month is going, and what to order.',
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {t('{measure}: the next {n} weeks', {
              measure: t.text(estimate.metric.label),
              n: HORIZON / 7,
            })}
          </CardTitle>
          {f ? (
            <CardDescription data-testid="estimate-headline">
              {aboutBefore}
              <strong>{formatEstimate(f.total, estimate.metric.format, style)}</strong>
              {aboutAfter}
            </CardDescription>
          ) : (
            <CardDescription>
              {t('We need at least two weeks of sales to estimate what’s coming.')}
            </CardDescription>
          )}
        </CardHeader>
        {f && (
          <CardContent className="grid gap-4">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('Estimate by week')}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t('Week')}</th>
                  <th scope="col">{t('Estimate')}</th>
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
                          {t('about {amount}', {
                            amount: formatEstimate(w.total, estimate.metric.format, style),
                          })}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul
              className="grid gap-1 text-sm text-muted-foreground"
              aria-label={t('What this assumes')}
            >
              {f.notes.map((n) => (
                <li key={n.kind}>{t.text(noteText(n, style.locale))}</li>
              ))}
              <li>
                {t(
                  'The range is how far the same method was off on your last few months. These are estimates, not promises.',
                )}
              </li>
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Monthly goals')}</CardTitle>
          <CardDescription>
            {t('Set a goal and we’ll show how the month is going and where it’s heading.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {goalMetrics
            .filter((m) => model.metrics.has(m))
            .map((m) => {
              const g = progress.find((p) => p.metric.id === m);
              const label = t.text(model.metrics.get(m)?.label ?? m);
              return (
                <div key={m} className="grid gap-3 border-b pb-6 last:border-b-0 last:pb-0">
                  {g ? (
                    <GoalProgressView goal={g} style={style} />
                  ) : (
                    <h3 className="font-semibold">{label}</h3>
                  )}
                  {editor ? (
                    <GoalEditor
                      slug={slug}
                      metricKey={m}
                      label={label}
                      current={saved.find((s) => s.metricKey === m)?.target ?? null}
                      money={model.metrics.get(m)?.format === 'money'}
                    />
                  ) : !g ? (
                    <p className="text-sm text-muted-foreground">{t('No goal set.')}</p>
                  ) : null}
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
            <span className="font-semibold">{t('What to reorder')}</span>
            <span className="text-sm text-muted-foreground">
              {reorder.lines.length === 0
                ? t('Nothing needs ordering right now.')
                : soon
                  ? t.plural(
                      reorder.lines.length,
                      '{n} product to order, {soon} may run out before a new order arrives.',
                      '{n} products to order, {soon} may run out before a new order arrives.',
                      { soon },
                    )
                  : t.plural(
                      reorder.lines.length,
                      '{n} product to order.',
                      '{n} products to order.',
                    )}
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      )}
    </div>
  );
}
