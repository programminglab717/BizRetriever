import { COMMON_CURRENCIES } from '@bizr/core/workspaces';

import { BusinessForm } from '@/components/settings/business-form';
import { DeleteBusiness } from '@/components/settings/delete-business';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

import { deleteBusiness, updateBusiness } from './actions';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, settings, role } = await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
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
