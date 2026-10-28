'use client';

import type { MentionView } from '@bizr/core/team';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { dismissMentionAction } from '@/app/w/[slug]/team-actions';
import { Button } from '@/components/ui/button';

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Notes that name you (M19), under "For you" on Home, until you say you've seen them. */
export function Mentions({ slug, initial }: { slug: string; initial: MentionView[] }) {
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-2" aria-label="Mentions" data-testid="mentions">
      {items.map((m) => {
        const href =
          m.subject.kind === 'answer' && m.subject.conversationId
            ? `/w/${slug}/ask?c=${m.subject.conversationId}`
            : `/w/${slug}/insights`;
        return (
          <li key={m.noteId} className="grid gap-1 rounded-xl border bg-card p-4 text-sm">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.author ?? 'Someone who left'}</span>{' '}
              mentioned you · {when.format(new Date(m.createdAt))}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="text-muted-foreground">
              On:{' '}
              <Link className="underline" href={href as Route}>
                {m.subject.title}
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
                Got it
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
