import { getInsights } from '@bizr/core/insights';
import { insightCategories, type InsightCategory } from '@bizr/packs';
import type { Route } from 'next';
import Link from 'next/link';

import { InsightFeed } from '@/components/insights/insight-feed';
import { PageHeader } from '@/components/shell/page-header';
import { queueInsights } from '@/lib/insights';
import { requireWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

const LABELS: Record<InsightCategory, string> = {
  stock: 'Stock',
  customers: 'Customers',
  profit: 'Profit',
  products: 'Products',
  trends: 'Trends',
  cash: 'Money owed',
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
  const chosen = insightCategories.find((c) => c === category);
  const overview = await getInsights(member, chosen ? { category: chosen } : {});
  if (overview.stale && member.workspace.dataVersion > 0)
    await queueInsights(member.workspace.id, 'home');
  const chip = (c: InsightCategory | undefined, label: string) => (
    <Link
      key={label}
      href={(c ? `/w/${slug}/insights?category=${c}` : `/w/${slug}/insights`) as Route}
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
        title="All insights"
        description={
          <>
            Everything we’ve spotted in your data, most important first. Dismissed ones are hidden.{' '}
            <Link href={`/w/${slug}/insights/settings`} className="text-primary hover:underline">
              Alert settings
            </Link>
          </>
        }
      />
      <nav aria-label="Filter by topic" className="flex flex-wrap gap-2">
        {chip(undefined, 'All')}
        {insightCategories.map((c) => chip(c, LABELS[c]))}
      </nav>
      <InsightFeed
        key={chosen ?? 'all'}
        slug={slug}
        insights={overview.insights.map(({ firstSeenAt: _f, lastSeenAt: _l, ...i }) => i)}
      />
    </div>
  );
}
