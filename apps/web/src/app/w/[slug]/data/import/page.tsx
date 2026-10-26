import { LinkSheetForm } from '@/components/import/link-sheet-form';
import { UploadForm } from '@/components/import/upload-form';
import { PageHeader } from '@/components/shell/page-header';
import { requireWorkspace } from '@/lib/session';

const HELPFUL = [
  ['Sales or orders', 'from your website, Etsy, Amazon or your till'],
  ['A stock or product list', 'with prices, costs and how many you have'],
  ['Supplier orders', 'what you bought, when and for how much'],
  ['Expenses', 'rent, postage, packaging and so on'],
] as const;

export default async function ImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Bring in your files"
        description="Upload the spreadsheets you already have. We’ll work out what’s in them and check anything we’re unsure about with you. Newer versions of files you brought in before are recognised, and you’ll see what changes before anything is updated."
      />
      <UploadForm slug={slug} />
      <LinkSheetForm slug={slug} />
      <section className="grid gap-2 text-sm">
        <h2 className="font-medium">Helpful files to include</h2>
        <ul className="grid gap-1 text-muted-foreground">
          {HELPFUL.map(([what, detail]) => (
            <li key={what}>
              <span className="text-foreground">{what}</span>, {detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
