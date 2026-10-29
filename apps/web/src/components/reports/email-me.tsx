'use client';

import { msg } from '@bizr/i18n/translate';
import { Loader2, Mail } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { createReportAction } from '@/app/w/[slug]/reports-actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

const DAYS = [
  msg('on Monday'),
  msg('on Tuesday'),
  msg('on Wednesday'),
  msg('on Thursday'),
  msg('on Friday'),
  msg('on Saturday'),
  msg('on Sunday'),
];

/** 1st, 2nd, 3rd, 4th… as the English list has always shown them (other languages: just the number). */
const englishOrdinal = (n: number) =>
  `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * "Email me this" (M15): the dashboard or an answer sent as a PDF every week or month, worked out
 * fresh each time. Only ever to the person setting it up.
 */
export function EmailMe({
  slug,
  what,
}: {
  slug: string;
  what: { kind: 'dashboard' } | { kind: 'question'; answerId: string };
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly');
  const [day, setDay] = useState(1);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // "On" (the weekday) reads differently from the switches' "On", so other languages get their own.
  const weekdayLabel = t.lang === 'en' ? 'On' : t('Day of the week');

  if (done)
    return (
      <span className="text-sm text-muted-foreground" role="status" data-testid="report-set">
        {done}{' '}
        <Link
          href={`/w/${slug}/insights/settings#reports` as Route}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t('Your reports')}
        </Link>
      </span>
    );
  if (!open)
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Mail /> {t('Email me this')}
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      aria-label={t('Email me this')}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await createReportAction(slug, { ...what, cadence, day });
          if (!r.ok) return setError(r.error);
          setDone(t('{when}, we’ll email you a PDF.', { when: t.text(r.data.when) }));
        });
      }}
    >
      <Select
        aria-label={t('How often')}
        className="h-9 w-auto"
        value={cadence}
        onChange={(e) => {
          setCadence(e.target.value === 'monthly' ? 'monthly' : 'weekly');
          setDay(1);
        }}
      >
        <option value="weekly">{t('Every week')}</option>
        <option value="monthly">{t('Every month')}</option>
      </Select>
      <Select
        aria-label={cadence === 'weekly' ? weekdayLabel : t('On day')}
        className="h-9 w-auto"
        value={day}
        onChange={(e) => setDay(Number(e.target.value))}
      >
        {cadence === 'weekly'
          ? DAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {t(d)}
              </option>
            ))
          : Array.from({ length: 28 }, (_, i) => (
              <option key={i} value={i + 1}>
                {t('on the {nth}', {
                  nth: t.lang === 'en' ? englishOrdinal(i + 1) : String(i + 1),
                })}
              </option>
            ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} {t('Email me')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t('Cancel')}
      </Button>
      {error && <span className="text-destructive">{error}</span>}
    </form>
  );
}
