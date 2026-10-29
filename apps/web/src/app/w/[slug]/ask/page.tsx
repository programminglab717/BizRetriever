import { answerView, getConversation, localeFor, suggestedQuestions } from '@bizr/core/ask';
import { getGlossary } from '@bizr/core/semantic';
import Link from 'next/link';

import { AskThread } from '@/components/ask/ask-thread';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { viewOptions } from '@/lib/ask';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AskPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string; q?: string }>;
}) {
  const { slug } = await params;
  const { c, q } = await searchParams;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const g = await getGlossary(member);
  const available = new Set(g.measures.filter((m) => m.available).map((m) => m.key));

  if (available.size === 0)
    return (
      <div className="grid gap-6">
        <PageHeader title={t('Ask anything about your business')} />
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <p>
              {t(
                'Once your data is in, you can ask questions like “Which products made me the most profit last month?”',
              )}
            </p>
            <div>
              <Button asChild>
                <Link href={`/w/${slug}/data/import`}>{t('Upload files')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  const options = viewOptions(member, t.lang);
  const conversationId = c && UUID.test(c) ? c : undefined;
  const turns = conversationId ? await getConversation(member, conversationId).catch(() => []) : [];
  return (
    <div className="grid gap-6">
      <PageHeader title={t('Ask anything about your business')} />
      <AskThread
        // i18n-skip: a React key, never shown
        key={conversationId ?? 'new'}
        slug={slug}
        {...(conversationId && turns.length ? { conversationId } : {})}
        initial={turns.map((x) => ({ question: x.question, answer: answerView(x, options) }))}
        chips={suggestedQuestions(member, available, 6, t.lang).map((x) => x.text)}
        {...(q ? { initialQuestion: q.slice(0, 500) } : {})}
        style={{ locale: localeFor(member.settings, t.lang), currency: member.settings.currency }}
      />
    </div>
  );
}
