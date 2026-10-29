'use client';

import type { DigestContent } from '@bizr/core/insights';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { hideDigest } from '@/app/w/[slug]/insights/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCanChange } from '@/components/shell/can-change';

/** The weekly summary on Home: last week against the one before, top new insights, a question. */
export function DigestCard({
  slug,
  id,
  content,
  weekLabel,
}: {
  slug: string;
  id: string;
  content: DigestContent;
  weekLabel: string;
}) {
  const t = useT();
  const editor = useCanChange();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section aria-label={t('Your week')} className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t('Your week')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('{week}, compared with the week before', { week: weekLabel })}
          </p>
        </div>
        {editor && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('Hide this summary')}
            onClick={() => {
              setHidden(true);
              void hideDigest(slug, id);
            }}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {content.kpis.length > 0 && (
        <dl className="grid grid-cols-2 gap-3">
          {content.kpis.map((k) => {
            const good =
              k.goodDirection === 'neutral' || k.direction === 'flat'
                ? undefined
                : k.direction === k.goodDirection;
            return (
              <div key={k.label} className="min-w-0">
                <dt className="text-sm text-muted-foreground">{t.text(k.label)}</dt>
                <dd className="text-xl font-semibold tabular-nums">{k.value}</dd>
                {k.change && (
                  <dd
                    className={cn(
                      'flex items-center gap-1 text-sm',
                      good === true && 'text-emerald-700',
                      good === false && 'text-destructive',
                      good === undefined && 'text-muted-foreground',
                    )}
                  >
                    {k.direction === 'up' ? (
                      <ArrowUp className="size-4" aria-label={t('Up')} />
                    ) : k.direction === 'down' ? (
                      <ArrowDown className="size-4" aria-label={t('Down')} />
                    ) : null}
                    {k.change}{' '}
                    <span className="text-muted-foreground">
                      {t('(was {amount})', { amount: k.previous })}
                    </span>
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      )}
      {content.insights.length > 0 && (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('New this week')}</h3>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {content.insights.map((i) => (
              <li key={i.id}>{t.text(i.text)}</li>
            ))}
          </ul>
        </div>
      )}
      {content.question && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">{t('A question you might ask')}</h3>
          <div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-auto whitespace-normal py-2 text-left"
            >
              <Link href={`/w/${slug}/ask?q=${encodeURIComponent(content.question)}` as Route}>
                {t.text(content.question)}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
