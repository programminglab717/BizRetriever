import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

export default async function HomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, user } = await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} description={workspace.name} />
      <Card>
        <CardHeader>
          <CardTitle>Let’s bring in your data</CardTitle>
          <CardDescription>
            Your sales, stock lists, supplier orders and expenses. Excel or CSV, messy is fine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm text-muted-foreground">
            <li>1. Upload the spreadsheets you already have.</li>
            <li>2. We work out what’s in them and check anything we’re unsure about with you.</li>
            <li>3. You get answers, a dashboard and alerts about your business.</li>
          </ol>
        </CardContent>
      </Card>
      <ComingSoon title="Uploading files">
        File upload arrives in the next update. We’ll let you know here when it’s ready.
      </ComingSoon>
    </div>
  );
}
