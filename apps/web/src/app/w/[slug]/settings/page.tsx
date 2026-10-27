import { canChange, COMMON_CURRENCIES, listMembers } from '@bizr/core/workspaces';

import { BusinessForm } from '@/components/settings/business-form';
import { DeleteBusiness } from '@/components/settings/delete-business';
import { Members } from '@/components/settings/members';
import { BusinessesSection } from '@/components/demo/businesses-section';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

import { deleteBusiness, updateBusiness } from './actions';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const { workspace, settings, role } = member;
  const people = await listMembers(member);
  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
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
              }}
              currencies={COMMON_CURRENCIES}
            />
          ) : (
            <dl className="grid gap-1 text-sm">
              <div>
                <dt className="inline text-muted-foreground">Name:</dt>{' '}
                <dd className="inline">{workspace.name}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Currency:</dt>{' '}
                <dd className="inline">{settings.currency}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Time zone:</dt>{' '}
                <dd className="inline">{settings.timezone}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <CardContent>
          <Members slug={slug} list={people} isOwner={role === 'owner'} me={member.user.id} />
        </CardContent>
      </Card>
      {/* On phones this lives on More. */}
      <div className="hidden md:block">
        <BusinessesSection userId={member.user.id} currentSlug={slug} />
      </div>
      {role === 'owner' ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Delete this business</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteBusiness action={deleteBusiness.bind(null, slug)} name={workspace.name} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
