import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { requireWorkspace } from '@/lib/session';

export default async function DataPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader title="My data" />
      <ComingSoon title="Your records">
        Your products, sales, customers and more will appear here once you’ve brought in your files.
      </ComingSoon>
    </div>
  );
}
