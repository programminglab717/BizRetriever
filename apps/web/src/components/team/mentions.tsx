'use client';

import type { MentionView } from '@bizr/core/team';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { dismissMentionAction } from '@/app/w/[slug]/team-actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Notes that name you (M19), under "For you" on Home, until you say you've seen them. */
export function Mentions({ slug, initial }: { slug: string; initial: MentionView[] }) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-2" aria-label={t('Mentions')} data-testid="mentions">
      {items.map((m) => {
        const href =
          m.subject.kind === 'answer' && m.subject.conversationId
            ? `/w/${slug}/ask?c=${m.subject.conversationId}`
            : `/w/${slug}/insights`;
        // The name is in bold inside the whole sentence.
        const who = t('{name} mentioned you · {date}', {
          date: when.format(new Date(m.createdAt)),
        }).split('{name}');
        return (
          <li key={m.noteId} className="grid gap-1 rounded-xl border bg-card p-4 text-sm">
            <p className="text-xs text-muted-foreground">
              {who[0]}
              <span className="font-medium text-foreground">
                {m.author ?? t('Someone who left')}
              </span>
              {who[1]}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="text-muted-foreground">
              {t('On:')}{' '}
              <Link className="underline" href={href as Route}>
                {m.subject.kind === 'insight' ? t.text(m.subject.title) : m.subject.title}
              </Link>
            </p>
            <div>
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await dismissMentionAction(slug, m.noteId);
                    if (r.ok) setItems((list) => list.filter((x) => x.noteId !== m.noteId));
                  })
                }
              >
                {t('Got it')}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
