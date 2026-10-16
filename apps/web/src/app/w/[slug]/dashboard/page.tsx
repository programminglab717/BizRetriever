import { localeFor } from '@bizr/core/ask';
import {
  dashboardRangeSchema,
  dashboardView,
  RANGE_PRESETS,
  type DashboardRange,
} from '@bizr/core/dashboard';
import Link from 'next/link';

import { DashboardBoard } from '@/components/dashboard/dashboard-board';
import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { requireWorkspace } from '@/lib/session';

/** Dates from the URL (?range=last_90_days&compare=0), validated; otherwise the saved choice. */
function rangeFromParams(p: { range?: string; compare?: string }): DashboardRange | undefined {
  if (!p.range) return undefined;
  const r = dashboardRangeSchema.safeParse({
    range: { preset: p.range },
    compare: p.compare !== '0',
  });
  return r.success ? r.data : undefined;
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; compare?: string }>;
}) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const view = await dashboardView(member, rangeFromParams(await searchParams));
  const style = { locale: localeFor(member.settings), currency: member.settings.currency };
  return (
    <div className="grid gap-6">
      <PageHeader title="Your business at a glance" />
      {view.tiles.length === 0 ? (
        <ComingSoon title="Your dashboard is waiting for your data">
          <p>Bring in your sales and stock files and we’ll build a dashboard for your shop.</p>
          <div className="mt-3">
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/data/import`}>Upload files</Link>
            </Button>
          </div>
        </ComingSoon>
      ) : (
        <DashboardBoard
          slug={slug}
          view={view}
          presets={RANGE_PRESETS.map((p) => ({ preset: p.preset, label: p.label }))}
          style={style}
        />
      )}
    </div>
  );
}
