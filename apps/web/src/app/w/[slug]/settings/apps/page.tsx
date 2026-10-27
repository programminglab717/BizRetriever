import { EVENT_LABELS, listApiKeys, listWebhooks, webhooksAvailable } from '@bizr/core/platform';
import { getEnv } from '@bizr/platform';
import type { Metadata } from 'next';

import { ApiKeys } from '@/components/apps/api-keys';
import { Assistants } from '@/components/apps/assistants';
import { Webhooks } from '@/components/apps/webhooks';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

export const metadata: Metadata = { title: 'Connect other apps · BizRetriever' };

/** Connect other apps (M16, ADR-066): keys, an AI assistant, webhooks. Owner only. */
export default async function ConnectAppsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const header = (
    <PageHeader
      title="Connect other apps"
      description="Let a spreadsheet, an accounting tool or an AI assistant read your numbers. They can look, never change anything."
    />
  );
  if (member.role !== 'owner' || member.workspace.isDemo)
    return (
      <div className="grid gap-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>
              {member.workspace.isDemo ? 'Not for the demo shop' : 'Only the owner can do this'}
            </CardTitle>
            <CardDescription>
              {member.workspace.isDemo
                ? 'Connect other apps to your own business, once you’ve brought your files in.'
                : 'Ask the owner of this business if another app needs to read its numbers.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  const base = getEnv().APP_URL;
  const [keys, hooks] = await Promise.all([
    listApiKeys(member),
    webhooksAvailable() ? listWebhooks(member) : Promise.resolve(null),
  ]);
  return (
    <div className="grid gap-6">
      {header}
      <ApiKeys
        slug={slug}
        initial={keys}
        docsUrl={`${base}/api/v1/openapi.json`}
        apiUrl={`${base}/api/v1`}
      />
      <Assistants mcpUrl={`${base}/api/mcp`} hasKey={keys.length > 0} />
      <Webhooks slug={slug} initial={hooks} events={EVENT_LABELS} />
    </div>
  );
}
