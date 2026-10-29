import { getAlertSettings, getEmailPreferences } from '@bizr/core/insights';
import { listReports } from '@bizr/core/reports';
import { canChange } from '@bizr/core/workspaces';
import Link from 'next/link';

import { AlertSettings } from '@/components/insights/alert-settings';
import { EmailSettings } from '@/components/insights/email-settings';
import { PageHeader } from '@/components/shell/page-header';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';
import { ViewOnlyNote } from '@/components/shell/view-only';
import { MyReports } from '@/components/reports/my-reports';

export default async function AlertSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const [settings, emails, reports] = await Promise.all([
    getAlertSettings(member, t.lang),
    getEmailPreferences(member.workspace.id, member.user.id),
    listReports(member, member.user.id),
  ]);
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t('Alert settings')}
        description={
          <>
            {t('Choose what we tell you about, and when.')}{' '}
            <Link
              href={`/w/${slug}/insights`}
              className="text-primary underline underline-offset-4"
            >
              {t('See all insights')}
            </Link>
          </>
        }
      />
      <EmailSettings
        slug={slug}
        initial={emails}
        email={member.user.email}
        verified={member.user.emailVerified}
      />
      <MyReports slug={slug} initial={reports} />
      {canChange(member.role) ? (
        <AlertSettings slug={slug} settings={settings} currency={member.settings.currency} />
      ) : (
        <ViewOnlyNote>{t('Alerts are set by the owner and members.')}</ViewOnlyNote>
      )}
    </div>
  );
}
