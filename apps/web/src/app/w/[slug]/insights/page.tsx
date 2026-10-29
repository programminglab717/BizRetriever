import { getInsights } from '@bizr/core/insights';
import { listNotes } from '@bizr/core/team';
import { msg } from '@bizr/i18n/translate';
import { insightCategories, type InsightCategory } from '@bizr/packs';
import type { Route } from 'next';
import Link from 'next/link';

import { InsightFeed } from '@/components/insights/insight-feed';
import { PageHeader } from '@/components/shell/page-header';
import { getT } from '@/lib/i18n';
import { queueInsights } from '@/lib/insights';
import { requireWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

const LABELS: Record<InsightCategory, string> = {
  stock: msg('Stock'),
  customers: msg('Customers'),
  profit: msg('Profit'),
  products: msg('Products'),
  trends: msg('Trends'),
  cash: msg('Money owed'),
};

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { slug } = await params;
  const { category } = await searchParams;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const chosen = insightCategories.find((c) => c === category);
  const overview = await getInsights(member, {
    ...(chosen ? { category: chosen } : {}),
    lang: t.lang,
  });
  const notes = await listNotes(
    member,
    member.user.id,
    'insight',
    overview.insights.map((i) => i.id),
  );
  if (overview.stale && member.workspace.dataVersion > 0)
    await queueInsights(member.workspace.id, 'home');
  const chip = (c: InsightCategory | undefined, label: string) => (
    <Link
      key={label}
      href={(c ? `/w/${slug}/insights?category=${c}` : `/w/${slug}/insights`) as Route}
      // i18n-skip
      aria-current={chosen === c ? 'page' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 text-sm',
        chosen === c ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t('All insights')}
        description={
          <>
            {t(
              'Everything we’ve spotted in your data, most important first. Dismissed ones are hidden.',
            )}{' '}
            <Link
              href={`/w/${slug}/insights/settings`}
              className="text-primary underline underline-offset-4"
            >
              {t('Alert settings')}
            </Link>
          </>
        }
      />
      <nav aria-label={t('Filter by topic')} className="flex flex-wrap gap-2">
        {chip(undefined, t('All'))}
        {insightCategories.map((c) => chip(c, t(LABELS[c])))}
      </nav>
      <InsightFeed
        // i18n-skip
        key={chosen ?? 'all'}
        slug={slug}
        insights={overview.insights.map(({ firstSeenAt: _f, lastSeenAt: _l, ...i }) => i)}
        notes={notes}
      />
    </div>
  );
}
