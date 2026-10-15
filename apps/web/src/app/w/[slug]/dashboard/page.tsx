import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { requireWorkspace } from '@/lib/session';

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader title="Dashboard" />
      <ComingSoon title="Your business at a glance">
        As soon as your data is in, we’ll build a dashboard for your shop: sales, profit, best
        sellers, what’s running low and more.
      </ComingSoon>
    </div>
  );
}
