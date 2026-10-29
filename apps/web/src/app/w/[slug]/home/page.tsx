import { listConnections } from '@bizr/core/connections';
import { listRuns } from '@bizr/core/ingestion';
import { currentDigest, getInsights, homeKpis } from '@bizr/core/insights';
import { localeFor } from '@bizr/core/ask';
import { goalProgress } from '@bizr/core/planning';
import { currentTransfer, listNotes, myMentions } from '@bizr/core/team';
import type { Route } from 'next';
import Link from 'next/link';

import { KpiCards } from '@/components/ask/answer-chart';
import { DigestCard } from '@/components/insights/digest-card';
import { GoalProgressView } from '@/components/plan/goal-progress';
import { InsightFeed } from '@/components/insights/insight-feed';
import { Mentions } from '@/components/team/mentions';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getT } from '@/lib/i18n';
import { queueInsights } from '@/lib/insights';
import { requireWorkspace } from '@/lib/session';

export default async function HomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const [[latest], sources, transfer] = await Promise.all([
    listRuns(member, 1),
    listConnections(member),
    currentTransfer(member, member.user.id),
  ]);
  const waiting = latest && ['review', 'merge_review'].includes(latest.status);
  // A linked source updating by itself isn't news; one waiting for the owner is.
  const inProgress =
    latest &&
    ['analyzing', 'review', 'revising', 'applying', 'merge_review', 'merging'].includes(
      latest.status,
    ) &&
    (waiting || !latest.connectionId)
      ? latest
      : undefined;
  const troubled = sources.filter((c) => c.status === 'needs_attention' && c.lastError);
  const hasData = member.workspace.dataVersion > 0;
  const header = (
    <PageHeader
      title={t('Welcome, {name}', { name: member.user.name.split(' ')[0] ?? '' })}
      description={member.workspace.name}
    />
  );
  // Someone asked this person to take the business over (M19).
  const takeover = transfer?.forMe && (
    <Card data-testid="takeover-home">
      <CardHeader>
        <CardTitle>
          {t('{from} wants to make you the owner of {business}', {
            from: transfer.fromName,
            business: member.workspace.name,
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href={`/w/${slug}/settings`}>{t('Answer in Settings')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
  const sourceCards = troubled.map((c) => (
    <Card key={c.id} data-testid="source-problem">
      <CardHeader>
        <CardTitle>{t('We couldn’t update from “{name}”', { name: c.name })}</CardTitle>
        <CardDescription>{c.lastError && t.text(c.lastError)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={`/w/${slug}/data`}>{t('See my data')}</Link>
        </Button>
      </CardContent>
    </Card>
  ));
  const progressCard = inProgress && (
    <Card>
      <CardHeader>
        <CardTitle>
          {inProgress.connectionId && waiting
            ? t('Your linked data has changes to check')
            : waiting
              ? t('Your files are ready to check')
              : t('We’re working on your files')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button asChild size="lg">
          <Link href={`/w/${slug}/data/import/${inProgress.id}` as Route}>{t('Continue')}</Link>
        </Button>
      </CardContent>
    </Card>
  );

  if (!hasData)
    return (
      <div className="grid grid-cols-1 gap-6">
        {header}
        {takeover}
        {progressCard || (
          <Card>
            <CardHeader>
              <CardTitle>{t('Let’s bring in your data')}</CardTitle>
              <CardDescription>
                {t(
                  'Your sales, stock lists, supplier orders and expenses. Excel or CSV, messy is fine.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ol className="grid gap-2 text-sm text-muted-foreground">
                <li>{t('1. Upload the spreadsheets you already have.')}</li>
                <li>
                  {t(
                    '2. We work out what’s in them and check anything we’re unsure about with you.',
                  )}
                </li>
                <li>{t('3. You get answers, a dashboard and alerts about your business.')}</li>
              </ol>
              <div>
                <Button asChild size="lg">
                  <Link href={`/w/${slug}/data/import`}>{t('Upload files')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );

  const [overview, forYou, mentions] = await Promise.all([
    getInsights(member, { limit: 5, lang: t.lang }),
    getInsights(member, { assignedTo: member.user.id, limit: 20, lang: t.lang }),
    myMentions(member, member.user.id),
  ]);
  const notes = await listNotes(member, member.user.id, 'insight', [
    ...forYou.insights.map((i) => i.id),
    ...overview.insights.map((i) => i.id),
  ]);
  const card = ({ firstSeenAt: _f, lastSeenAt: _l, ...i }: (typeof overview.insights)[number]) => i;
  // The data changed or a new day began since the last check: look again (one run per business).
  if (overview.stale) await queueInsights(member.workspace.id, 'home');
  const [kpis, digest, goals] = await Promise.all([
    homeKpis(member, { lang: t.lang }),
    currentDigest(member),
    goalProgress(member),
  ]);
  const locale = localeFor(member.settings, t.lang);
  const weekLabel = digest
    ? t('Week of {date}', {
        date: new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(`${digest.content.period.from}T00:00:00Z`)),
      })
    : '';

  return (
    <div className="grid grid-cols-1 gap-6">
      {header}
      {progressCard}
      {sourceCards}
      {kpis.kpis.length > 0 && (
        <section aria-label={t('Key numbers')} className="grid gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('Last 30 days')}</h2>
          <KpiCards
            kpis={kpis.kpis}
            compact
            {...(kpis.comparedWith ? { comparedWith: kpis.comparedWith } : {})}
          />
        </section>
      )}
      {goals.length > 0 && (
        <section aria-labelledby="goals-heading" className="grid gap-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="goals-heading" className="font-semibold">
              {t('This month’s goals')}
            </h2>
            <Link
              href={`/w/${slug}/plan` as Route}
              className="text-sm text-primary hover:underline"
            >
              {t('Plan ahead')}
            </Link>
          </div>
          {goals.map((g) => (
            <GoalProgressView
              key={g.metric.id}
              goal={g}
              style={{ locale, currency: member.settings.currency }}
            />
          ))}
        </section>
      )}
      <form action={`/w/${slug}/ask`} className="flex gap-2" role="search">
        <Input
          name="q"
          placeholder={t('Ask anything about your business')}
          aria-label={t('Ask anything about your business')}
          maxLength={500}
          className="h-11"
        />
        <Button type="submit" size="lg">
          {t('Ask')}
        </Button>
      </form>
      {digest && (
        <DigestCard slug={slug} id={digest.id} content={digest.content} weekLabel={weekLabel} />
      )}
      {takeover}
      {(forYou.insights.length > 0 || mentions.length > 0) && (
        <section className="grid gap-3" aria-labelledby="for-you" data-testid="for-you">
          <h2 id="for-you" className="text-lg font-semibold">
            {t('For you')}
          </h2>
          <Mentions slug={slug} initial={mentions} />
          {forYou.insights.length > 0 && (
            <InsightFeed
              slug={slug}
              insights={forYou.insights.map(card)}
              notes={notes}
              label={t('For you')}
            />
          )}
        </section>
      )}
      <section className="grid gap-3" aria-labelledby="attention">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="attention" className="text-lg font-semibold">
            {t('Needs your attention')}
          </h2>
          <Link href={`/w/${slug}/insights`} className="text-sm text-primary hover:underline">
            {t('See all insights')}
          </Link>
        </div>
        {!overview.lastRun ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
            {t(
              'We’re looking through your data for anything that needs your attention. This takes a moment.',
            )}
          </p>
        ) : (
          <InsightFeed
            slug={slug}
            insights={overview.insights.filter((i) => i.assignedTo !== member.user.id).map(card)}
            notes={notes}
          />
        )}
        {overview.waitingForHistory && (
          <p className="text-sm text-muted-foreground">
            {t('We need about 4 weeks of sales to spot trends. We’ll start as soon as we can.')}
          </p>
        )}
      </section>
    </div>
  );
}
