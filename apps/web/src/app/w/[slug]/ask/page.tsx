import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { requireWorkspace } from '@/lib/session';

const EXAMPLES = [
  'Which products made me the most profit last month?',
  'What’s about to run out?',
  'Which customers stopped ordering?',
];

export default async function AskPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader title="Ask anything about your business" />
      <ComingSoon title="Ask in plain language">
        <p>Once your data is in, you’ll be able to ask questions like:</p>
        <ul className="mt-2 grid gap-1">
          {EXAMPLES.map((q) => (
            <li key={q}>“{q}”</li>
          ))}
        </ul>
      </ComingSoon>
    </div>
  );
}
