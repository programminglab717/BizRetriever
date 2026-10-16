import { getAlertSettings } from '@bizr/core/insights';
import Link from 'next/link';

import { AlertSettings } from '@/components/insights/alert-settings';
import { PageHeader } from '@/components/shell/page-header';
import { requireWorkspace } from '@/lib/session';

export default async function AlertSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const settings = await getAlertSettings(member);
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Alert settings"
        description={
          <>
            Choose what we tell you about, and when.{' '}
            <Link
              href={`/w/${slug}/insights`}
              className="text-primary underline underline-offset-4"
            >
              See all insights
            </Link>
          </>
        }
      />
      <AlertSettings slug={slug} settings={settings} currency={member.settings.currency} />
    </div>
  );
}
