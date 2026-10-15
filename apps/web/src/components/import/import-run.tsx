'use client';

import { AlertTriangle, Check, CheckCircle2, Lightbulb, Loader2, SkipForward } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImportView } from '@/lib/imports';
import { cn } from '@/lib/utils';

import { Review } from './review';

const BUSY = new Set(['analyzing', 'revising', 'applying']);
const POLL_MS = 1_500;
const fmt = new Intl.NumberFormat('en-US');

/** The import screens (processing → review → setting up → report), kept fresh by polling. */
export function ImportRun({ slug, initial }: { slug: string; initial: ImportView }) {
  const [view, setView] = useState(initial);
  const [refreshKey, setRefreshKey] = useState(0);
  const busy = BUSY.has(view.status);

  useEffect(() => {
    if (!busy) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/w/${slug}/imports/${view.runId}`, { cache: 'no-store' });
        if (res.ok && !stopped) setView((await res.json()) as ImportView);
      } catch {
        // offline for a moment; try again next tick
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [busy, slug, view.runId, refreshKey]);

  /** After an action: the run is now busy server-side; start polling straight away. */
  const onAction = () => {
    setView((v) => ({ ...v, status: v.status === 'review' ? 'revising' : v.status }));
    setRefreshKey((k) => k + 1);
  };

  switch (view.status) {
    case 'analyzing':
      return <Processing view={view} kind="analyze" />;
    case 'applying':
      return <Processing view={view} kind="apply" />;
    case 'review':
    case 'revising':
      return view.proposal ? (
        <Review
          slug={slug}
          runId={view.runId}
          proposal={view.proposal}
          currency={view.currency}
          updating={view.status === 'revising'}
          onAction={onAction}
          onApproved={() => {
            setView((v) => ({ ...v, status: 'applying', progress: null }));
            setRefreshKey((k) => k + 1);
          }}
        />
      ) : (
        <Processing view={view} kind="analyze" />
      );
    case 'done':
      return <Report slug={slug} view={view} />;
    case 'failed':
      return (
        <Card>
          <CardHeader>
            <CardTitle>We couldn’t finish this import</CardTitle>
            <CardDescription>
              Your files are safe and nothing in your data was changed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Alert tone="error">
              {view.error ?? 'Something went wrong while reading your files.'}
            </Alert>
            <div>
              <Button asChild>
                <Link href={`/w/${slug}/data/import`}>Try again with different files</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    case 'cancelled':
      return (
        <Card>
          <CardHeader>
            <CardTitle>You stopped this import</CardTitle>
            <CardDescription>Nothing from these files was brought in.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/w/${slug}/data/import`}>Upload files</Link>
            </Button>
          </CardContent>
        </Card>
      );
  }
}

const ANALYZE_STAGES = [
  { label: 'Opening your files', until: 25 },
  { label: 'Finding the real data (skipping titles, totals and blank lines)', until: 25 },
  { label: 'Working out what each detail means', until: 60 },
  { label: 'Checking how everything links together', until: 60 },
  { label: 'Doing a test run', until: 100 },
];
const APPLY_STAGES = [
  { label: 'Creating your records', until: 40 },
  { label: 'Bringing in your records', until: 85 },
  { label: 'Writing your data report', until: 100 },
];

function Processing({ view, kind }: { view: ImportView; kind: 'analyze' | 'apply' }) {
  const pct = view.progress?.pct ?? 0;
  const stages = kind === 'analyze' ? ANALYZE_STAGES : APPLY_STAGES;
  const current = stages.findIndex((s) => pct < s.until);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{kind === 'analyze' ? 'Working on it' : 'Setting things up'}</CardTitle>
        <CardDescription>
          {kind === 'analyze'
            ? `Looking through ${view.files.length === 1 ? 'your file' : `your ${view.files.length} files`}. This usually takes under a minute. You can close this page; we’ll keep going.`
            : 'Bringing your records in. This takes a few moments.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <ol className="grid gap-3" aria-live="polite">
          {stages.map((s, i) => {
            const done = current === -1 || i < current;
            const active = i === current;
            return (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                {done ? (
                  <Check className="size-4 text-emerald-600" aria-label="Done" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin text-primary" aria-label="In progress" />
                ) : (
                  <span className="size-4 rounded-full border" aria-hidden />
                )}
                <span className={cn(!done && !active && 'text-muted-foreground')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
        {view.spotted.length > 0 ? (
          <div className="grid gap-1 rounded-lg bg-muted/50 p-4 text-sm">
            <p className="font-medium">What we’ve spotted so far</p>
            {view.spotted.slice(0, 5).map((s) => (
              <p key={s} className="text-muted-foreground">
                {s}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Report({ slug, view }: { slug: string; view: ImportView }) {
  const r = view.report;
  if (!r) return <Processing view={view} kind="apply" />;
  const brought = r.entities
    .filter((e) => e.count > 0)
    .map(
      (e) =>
        `${fmt.format(e.count)} ${(e.count === 1 ? e.label.singular : e.label.plural).toLowerCase()}`,
    );
  const skippedTotal = r.skipped.reduce((n, s) => n + s.count, 0);
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your data is ready</h1>
        <p className="text-muted-foreground">
          Here’s what we brought in, and anything worth knowing.
        </p>
      </header>
      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm">
          <p className="flex gap-3" data-testid="report-brought-in">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <strong>{brought.join(', ')}</strong> brought in.
            </span>
          </p>
          {skippedTotal > 0 ? (
            <p className="flex gap-3">
              <SkipForward className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {fmt.format(skippedTotal)} {skippedTotal === 1 ? 'line' : 'lines'} skipped (
                {r.skipped
                  .map((s) => `${s.label.toLowerCase()}: ${fmt.format(s.count)}`)
                  .join(', ')}
                ).
              </span>
            </p>
          ) : null}
          {r.warnings.map((w) => (
            <p key={w} className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <span>{w} We kept these records and marked what’s missing.</span>
            </p>
          ))}
          {r.assumptions.length > 0 ? (
            <details className="group">
              <summary className="flex cursor-pointer gap-3">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>Things we assumed ({r.assumptions.length})</span>
              </summary>
              <ul className="mt-2 grid list-disc gap-1 pl-12 text-muted-foreground">
                {r.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={`/w/${slug}/dashboard`}>See my dashboard</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={`/w/${slug}/data`}>Go to my data</Link>
        </Button>
      </div>
    </div>
  );
}
