'use client';

import { Loader2, Mail } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { createReportAction } from '@/app/w/[slug]/reports-actions';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly');
  const [day, setDay] = useState(1);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done)
    return (
      <span className="text-sm text-muted-foreground" role="status" data-testid="report-set">
        {done}{' '}
        <Link
          href={`/w/${slug}/insights/settings#reports` as Route}
          className="text-primary underline-offset-4 hover:underline"
        >
          Your reports
        </Link>
      </span>
    );
  if (!open)
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Mail /> Email me this
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      aria-label="Email me this"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await createReportAction(slug, { ...what, cadence, day });
          if (!r.ok) return setError(r.error);
          setDone(`${r.data.when}, we’ll email you a PDF.`);
        });
      }}
    >
      <Select
        aria-label="How often"
        className="h-9 w-auto"
        value={cadence}
        onChange={(e) => {
          setCadence(e.target.value === 'monthly' ? 'monthly' : 'weekly');
          setDay(1);
        }}
      >
        <option value="weekly">Every week</option>
        <option value="monthly">Every month</option>
      </Select>
      <Select
        aria-label={cadence === 'weekly' ? 'On' : 'On day'}
        className="h-9 w-auto"
        value={day}
        onChange={(e) => setDay(Number(e.target.value))}
      >
        {cadence === 'weekly'
          ? DAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                on {d}
              </option>
            ))
          : Array.from({ length: 28 }, (_, i) => (
              <option key={i} value={i + 1}>
                on the {i + 1}
                {i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'}
              </option>
            ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} Email me
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <span className="text-destructive">{error}</span>}
    </form>
  );
}
