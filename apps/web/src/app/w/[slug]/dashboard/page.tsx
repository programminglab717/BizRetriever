import { dashboardTiles, localeFor } from '@bizr/core/ask';
import Link from 'next/link';

import { DashboardTile } from '@/components/ask/tile';
import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { requireWorkspace } from '@/lib/session';

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const tiles = await dashboardTiles(member);
  const style = { locale: localeFor(member.settings), currency: member.settings.currency };
  return (
    <div className="grid gap-6">
      <PageHeader title="Dashboard" />
      {tiles.length === 0 ? (
        <ComingSoon title="Your business at a glance">
          <p>
            Your dashboard is on its way. Until then, ask a question and tap “Add to dashboard” to
            keep the answer here.
          </p>
          <div className="mt-3">
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/ask`}>Ask a question</Link>
            </Button>
          </div>
        </ComingSoon>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tiles.map((t) => (
            <DashboardTile key={t.id} tile={t} style={style} />
          ))}
        </div>
      )}
    </div>
  );
}
