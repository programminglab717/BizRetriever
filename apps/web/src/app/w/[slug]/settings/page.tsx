import { currentTransfer } from '@bizr/core/team';
import {
  canChange,
  COMMON_CURRENCIES,
  hasRecords,
  listMembers,
  userLanguage,
} from '@bizr/core/workspaces';
import type { Route } from 'next';
import Link from 'next/link';

import { BusinessForm } from '@/components/settings/business-form';
import { DeleteBusiness } from '@/components/settings/delete-business';
import { Members } from '@/components/settings/members';
import { MyLanguage } from '@/components/settings/my-language';
import { HandOver, TakeOver } from '@/components/settings/ownership';
import { BusinessesSection } from '@/components/demo/businesses-section';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

import { deleteBusiness, setMyLanguage, updateBusiness } from './actions';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const { workspace, settings, role } = member;
  const [people, transfer, currencyLocked, ownLanguage] = await Promise.all([
    listMembers(member),
    currentTransfer(member, member.user.id),
    hasRecords(workspace.id),
    userLanguage(member.user.id),
  ]);
  return (
    <div className="grid gap-6">
      <PageHeader title={t('Settings')} />
      {transfer?.forMe && (
        <TakeOver slug={slug} transfer={transfer} businessName={workspace.name} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('You')}</CardTitle>
        </CardHeader>
        <CardContent>
          <MyLanguage
            action={setMyLanguage.bind(null, slug)}
            own={ownLanguage}
            business={settings.language}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Business details')}</CardTitle>
        </CardHeader>
        <CardContent>
          {canChange(role) ? (
            <BusinessForm
              action={updateBusiness.bind(null, slug)}
              name={workspace.name}
              settings={{
                currency: settings.currency,
                timezone: settings.timezone,
                dateOrder: settings.dateOrder,
                language: settings.language,
              }}
              currencies={COMMON_CURRENCIES}
              currencyLocked={currencyLocked}
            />
          ) : (
            <dl className="grid gap-1 text-sm">
              <div>
                <dt className="inline text-muted-foreground">{t('Name:')}</dt>{' '}
                <dd className="inline">{workspace.name}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{t('Currency:')}</dt>{' '}
                <dd className="inline">{settings.currency}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{t('Time zone:')}</dt>{' '}
                <dd className="inline">{settings.timezone}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('People')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Members slug={slug} list={people} isOwner={role === 'owner'} me={member.user.id} />
        </CardContent>
      </Card>
      {role === 'owner' && !workspace.isDemo ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('Connect other apps')}</CardTitle>
            <CardDescription>
              {t(
                'Let a spreadsheet, an accounting tool or an AI assistant read your numbers, and tell other apps when something new happens.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              className="text-sm font-medium underline"
              href={`/w/${slug}/settings/apps` as Route}
            >
              {t('Keys, AI assistants and webhooks')}
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {/* On phones this lives on More. */}
      <div className="hidden md:block">
        <BusinessesSection userId={member.user.id} currentSlug={slug} />
      </div>
      {role === 'owner' && !workspace.isDemo ? (
        <HandOver
          slug={slug}
          businessName={workspace.name}
          people={people.members
            .filter((p) => p.userId !== member.user.id)
            .map((p) => ({ id: p.userId, name: p.name }))}
          waiting={transfer}
        />
      ) : null}
      {role === 'owner' ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>{t('Delete this business')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteBusiness action={deleteBusiness.bind(null, slug)} name={workspace.name} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
