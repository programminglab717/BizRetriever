'use client';

import type { ReportView } from '@bizr/core/reports';
import { useState, useTransition } from 'react';

import { updateReportAction } from '@/app/w/[slug]/reports-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

/** Your scheduled reports (M15): what, how often, last sent; pause or delete. */
export function MyReports({ slug, initial }: { slug: string; initial: ReportView[] }) {
  const [reports, setReports] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (id: string, change: { paused: boolean } | 'delete') =>
    start(async () => {
      setError(null);
      const r = await updateReportAction(slug, id, change);
      if (!r.ok) return setError(r.error);
      setReports((list) =>
        change === 'delete'
          ? list.filter((x) => x.id !== id)
          : list.map((x) => (x.id === id ? { ...x, paused: change.paused } : x)),
      );
    });
  return (
    <Card id="reports">
      <CardHeader>
        <CardTitle>Your reports</CardTitle>
        <CardDescription>
          PDFs emailed to you, worked out fresh each time. Set one up with “Email me this” on the
          dashboard or under an answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {reports.length === 0 ? (
          <p className="text-muted-foreground">You haven’t set up any reports yet.</p>
        ) : (
          <ul className="grid divide-y" aria-label="Your reports">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="grid">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-muted-foreground">
                    {r.paused ? 'Paused' : r.when}
                    {r.lastSentAt ? ` · last sent ${when.format(new Date(r.lastSentAt))}` : ''}
                    {r.lastError ? ` · ${r.lastError}` : ''}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => act(r.id, { paused: !r.paused })}
                  >
                    {r.paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => act(r.id, 'delete')}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
