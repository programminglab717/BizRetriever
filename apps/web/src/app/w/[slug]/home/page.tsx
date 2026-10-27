import { listConnections } from '@bizr/core/connections';
import { listRuns } from '@bizr/core/ingestion';
import { currentDigest, getInsights, homeKpis } from '@bizr/core/insights';
import { localeFor } from '@bizr/core/ask';
import { goalProgress } from '@bizr/core/planning';
import { listNotes } from '@bizr/core/team';
import type { Route } from 'next';
import Link from 'next/link';

import { KpiCards } from '@/components/ask/answer-chart';
import { DigestCard } from '@/components/insights/digest-card';
import { GoalProgressView } from '@/components/plan/goal-progress';
import { InsightFeed } from '@/components/insights/insight-feed';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { queueInsights } from '@/lib/insights';
import { requireWorkspace } from '@/lib/session';

export default async function HomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const [[latest], sources] = await Promise.all([listRuns(member, 1), listConnections(member)]);
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
      title={`Welcome, ${member.user.name.split(' ')[0]}`}
      description={member.workspace.name}
    />
  );
  const sourceCards = troubled.map((c) => (
    <Card key={c.id} data-testid="source-problem">
      <CardHeader>
        <CardTitle>We couldn’t update from “{c.name}”</CardTitle>
        <CardDescription>{c.lastError}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={`/w/${slug}/data`}>See my data</Link>
        </Button>
      </CardContent>
    </Card>
  ));
  const progressCard = inProgress && (
    <Card>
      <CardHeader>
        <CardTitle>
          {inProgress.connectionId && waiting
            ? 'Your linked data has changes to check'
            : waiting
              ? 'Your files are ready to check'
              : 'We’re working on your files'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button asChild size="lg">
          <Link href={`/w/${slug}/data/import/${inProgress.id}` as Route}>Continue</Link>
        </Button>
      </CardContent>
    </Card>
  );

  if (!hasData)
    return (
      <div className="grid grid-cols-1 gap-6">
        {header}
        {progressCard || (
          <Card>
            <CardHeader>
              <CardTitle>Let’s bring in your data</CardTitle>
              <CardDescription>
                Your sales, stock lists, supplier orders and expenses. Excel or CSV, messy is fine.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ol className="grid gap-2 text-sm text-muted-foreground">
                <li>1. Upload the spreadsheets you already have.</li>
                <li>
                  2. We work out what’s in them and check anything we’re unsure about with you.
                </li>
                <li>3. You get answers, a dashboard and alerts about your business.</li>
              </ol>
              <div>
                <Button asChild size="lg">
                  <Link href={`/w/${slug}/data/import`}>Upload files</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );

  const [overview, forYou] = await Promise.all([
    getInsights(member, { limit: 5 }),
    getInsights(member, { assignedTo: member.user.id, limit: 20 }),
  ]);
  const notes = await listNotes(member, member.user.id, 'insight', [
    ...forYou.insights.map((i) => i.id),
    ...overview.insights.map((i) => i.id),
  ]);
  const card = ({ firstSeenAt: _f, lastSeenAt: _l, ...i }: (typeof overview.insights)[number]) => i;
  // The data changed or a new day began since the last check: look again (one run per business).
  if (overview.stale) await queueInsights(member.workspace.id, 'home');
  const [kpis, digest, goals] = await Promise.all([
    homeKpis(member),
    currentDigest(member),
    goalProgress(member),
  ]);
  const locale = localeFor(member.settings);
  const weekLabel = digest
    ? `Week of ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${digest.content.period.from}T00:00:00Z`))}`
    : '';

  return (
    <div className="grid grid-cols-1 gap-6">
      {header}
      {progressCard}
      {sourceCards}
      {kpis.kpis.length > 0 && (
        <section aria-label="Key numbers" className="grid gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Last 30 days</h2>
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
              This month’s goals
            </h2>
            <Link
              href={`/w/${slug}/plan` as Route}
              className="text-sm text-primary hover:underline"
            >
              Plan ahead
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
          placeholder="Ask anything about your business"
          aria-label="Ask anything about your business"
          maxLength={500}
          className="h-11"
        />
        <Button type="submit" size="lg">
          Ask
        </Button>
      </form>
      {digest && (
        <DigestCard slug={slug} id={digest.id} content={digest.content} weekLabel={weekLabel} />
      )}
      {forYou.insights.length > 0 && (
        <section className="grid gap-3" aria-labelledby="for-you" data-testid="for-you">
          <h2 id="for-you" className="text-lg font-semibold">
            For you
          </h2>
          <InsightFeed
            slug={slug}
            insights={forYou.insights.map(card)}
            notes={notes}
            label="For you"
          />
        </section>
      )}
      <section className="grid gap-3" aria-labelledby="attention">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="attention" className="text-lg font-semibold">
            Needs your attention
          </h2>
          <Link href={`/w/${slug}/insights`} className="text-sm text-primary hover:underline">
            See all insights
          </Link>
        </div>
        {!overview.lastRun ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
            We’re looking through your data for anything that needs your attention. This takes a
            moment.
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
            We need about 4 weeks of sales to spot trends. We’ll start as soon as we can.
          </p>
        )}
      </section>
    </div>
  );
}
