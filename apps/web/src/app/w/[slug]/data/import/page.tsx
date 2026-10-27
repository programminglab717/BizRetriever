import { shopifyEnabled } from '@bizr/core/connections';
import { canChange } from '@bizr/core/workspaces';
import { getPack } from '@bizr/packs';

import { ConnectShopifyForm } from '@/components/import/connect-shopify-form';
import { LinkSheetForm } from '@/components/import/link-sheet-form';
import { UploadForm } from '@/components/import/upload-form';
import { PageHeader } from '@/components/shell/page-header';
import { ViewOnlyNote } from '@/components/shell/view-only';
import { requireWorkspace } from '@/lib/session';

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ shopify?: string }>;
}) {
  const { slug } = await params;
  const { role, workspace } = await requireWorkspace(slug);
  const helpful = getPack(workspace.packId).manifest.helpful_files;
  const { shopify } = await searchParams;
  if (!canChange(role))
    return (
      <div className="grid gap-6">
        <PageHeader title="Bring in your files" />
        <ViewOnlyNote>Bringing in files is for the owner and members.</ViewOnlyNote>
      </div>
    );
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Bring in your files"
        description="Upload the spreadsheets you already have. We’ll work out what’s in them and check anything we’re unsure about with you. Newer versions of files you brought in before are recognised, and you’ll see what changes before anything is updated."
      />
      <UploadForm slug={slug} />
      <LinkSheetForm slug={slug} />
      {shopifyEnabled() && <ConnectShopifyForm slug={slug} badShop={shopify === 'bad_shop'} />}
      <section className="grid gap-2 text-sm">
        <h2 className="font-medium">Helpful files to include</h2>
        <ul className="grid gap-1 text-muted-foreground">
          {helpful.map(({ what, detail }) => (
            <li key={what}>
              <span className="text-foreground">{what}</span>, {detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
