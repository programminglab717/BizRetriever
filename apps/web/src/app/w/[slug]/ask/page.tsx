import { answerView, getConversation, localeFor, suggestedQuestions } from '@bizr/core/ask';
import { getGlossary } from '@bizr/core/semantic';
import Link from 'next/link';

import { AskThread } from '@/components/ask/ask-thread';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { viewOptions } from '@/lib/ask';
import { requireWorkspace } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { slug } = await params;
  const { c } = await searchParams;
  const member = await requireWorkspace(slug);
  const g = await getGlossary(member);
  const available = new Set(g.measures.filter((m) => m.available).map((m) => m.key));

  if (available.size === 0)
    return (
      <div className="grid gap-6">
        <PageHeader title="Ask anything about your business" />
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <p>
              Once your data is in, you can ask questions like “Which products made me the most
              profit last month?”
            </p>
            <div>
              <Button asChild>
                <Link href={`/w/${slug}/data/import`}>Upload files</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  const options = viewOptions(member);
  const conversationId = c && UUID.test(c) ? c : undefined;
  const turns = conversationId ? await getConversation(member, conversationId).catch(() => []) : [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Ask anything about your business" />
      <AskThread
        key={conversationId ?? 'new'}
        slug={slug}
        {...(conversationId && turns.length ? { conversationId } : {})}
        initial={turns.map((t) => ({ question: t.question, answer: answerView(t, options) }))}
        chips={suggestedQuestions(member, available).map((q) => q.text)}
        style={{ locale: localeFor(member.settings), currency: member.settings.currency }}
      />
    </div>
  );
}
