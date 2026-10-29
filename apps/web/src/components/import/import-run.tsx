'use client';

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Lightbulb,
  Loader2,
  SkipForward,
  Undo2,
} from 'lucide-react';
import { msg } from '@bizr/i18n/translate';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { undoImport } from '@/app/w/[slug]/data/import/[runId]/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImportView } from '@/lib/imports';
import { cn } from '@/lib/utils';
import { useCanChange } from '@/components/shell/can-change';

import { Bold, countOf, MergeReview } from './merge-review';
import { Review } from './review';

const BUSY = new Set(['analyzing', 'revising', 'applying', 'merging']);
const POLL_MS = 1_500;
const fmt = new Intl.NumberFormat('en-US');

/** The import screens (processing → review → setting up → report), kept fresh by polling. */
export function ImportRun({ slug, initial }: { slug: string; initial: ImportView }) {
  const t = useT();
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
      // i18n-skip (kinds of step, not text)
      return <Processing view={view} kind={view.kind === 'reupload' ? 'compare' : 'apply'} />;
    case 'merging':
      return <Processing view={view} kind="merge" />;
    case 'merge_review':
      return view.merge ? (
        <MergeReview
          slug={slug}
          runId={view.runId}
          preview={view.merge}
          onMerged={() => {
            setView((v) => ({ ...v, status: 'merging', progress: null }));
            setRefreshKey((k) => k + 1);
          }}
        />
      ) : (
        <Processing view={view} kind="compare" />
      );
    case 'review':
    case 'revising':
      return view.proposal ? (
        <Review
          slug={slug}
          runId={view.runId}
          proposal={view.proposal}
          currency={view.currency}
          reupload={view.kind === 'reupload'}
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
      return view.kind === 'reupload' ? (
        <UpdateReport
          slug={slug}
          view={view}
          onUndone={() => setView((v) => ({ ...v, undone: true }))}
        />
      ) : (
        <Report slug={slug} view={view} />
      );
    case 'failed':
      return (
        <Card>
          <CardHeader>
            <CardTitle>{t('We couldn’t finish this import')}</CardTitle>
            <CardDescription>
              {t('Your files are safe and nothing in your data was changed.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Alert tone="error">
              {view.error
                ? t.text(view.error)
                : t('Something went wrong while reading your files.')}
            </Alert>
            <div>
              <Button asChild>
                <Link href={`/w/${slug}/data/import`}>{t('Try again with different files')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    case 'cancelled':
      return (
        <Card>
          <CardHeader>
            <CardTitle>{t('You stopped this import')}</CardTitle>
            <CardDescription>{t('Nothing from these files was brought in.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/w/${slug}/data/import`}>{t('Upload files')}</Link>
            </Button>
          </CardContent>
        </Card>
      );
  }
}

const ANALYZE_STAGES = [
  { label: msg('Opening your files'), until: 25 },
  { label: msg('Finding the real data (skipping titles, totals and blank lines)'), until: 25 },
  { label: msg('Working out what each detail means'), until: 60 },
  { label: msg('Checking how everything links together'), until: 60 },
  { label: msg('Doing a test run'), until: 100 },
];
const APPLY_STAGES = [
  { label: msg('Creating your records'), until: 40 },
  { label: msg('Bringing in your records'), until: 85 },
  { label: msg('Writing your data report'), until: 100 },
];
const COMPARE_STAGES = [
  { label: msg('Reading the new files'), until: 50 },
  { label: msg('Comparing them with your data'), until: 100 },
];
const MERGE_STAGES = [
  { label: msg('Updating your records'), until: 80 },
  { label: msg('Refreshing your numbers'), until: 100 },
];

type ProcessingKind = 'analyze' | 'apply' | 'compare' | 'merge';
const PROCESSING: Record<ProcessingKind, { title: string; stages: typeof APPLY_STAGES }> = {
  analyze: { title: msg('Working on it'), stages: ANALYZE_STAGES },
  apply: { title: msg('Setting things up'), stages: APPLY_STAGES },
  compare: { title: msg('Comparing with your data'), stages: COMPARE_STAGES },
  merge: { title: msg('Updating your data'), stages: MERGE_STAGES },
};

function Processing({ view, kind }: { view: ImportView; kind: ProcessingKind }) {
  const t = useT();
  const pct = view.progress?.pct ?? 0;
  const { title, stages } = PROCESSING[kind];
  const current = stages.findIndex((s) => pct < s.until);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(title)}</CardTitle>
        <CardDescription>
          {kind === 'analyze'
            ? t.plural(
                view.files.length,
                'Looking through your file. This usually takes under a minute. You can close this page; we’ll keep going.',
                'Looking through your {n} files. This usually takes under a minute. You can close this page; we’ll keep going.',
              )
            : kind === 'compare'
              ? t('Working out what’s new and what changed. Nothing is changed yet.')
              : t('This takes a few moments.')}
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
                  <Check className="size-4 text-emerald-600" aria-label={t('Done')} />
                ) : active ? (
                  <Loader2
                    className="size-4 animate-spin text-primary"
                    aria-label={t('In progress')}
                  />
                ) : (
                  <span className="size-4 rounded-full border" aria-hidden />
                )}
                <span className={cn(!done && !active && 'text-muted-foreground')}>
                  {t(s.label)}
                </span>
              </li>
            );
          })}
        </ol>
        {view.spotted.length > 0 ? (
          <div className="grid gap-1 rounded-lg bg-muted/50 p-4 text-sm">
            <p className="font-medium">{t('What we’ve spotted so far')}</p>
            {view.spotted.slice(0, 5).map((s) => (
              <p key={s} className="text-muted-foreground">
                {t.text(s)}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Report({ slug, view }: { slug: string; view: ImportView }) {
  const t = useT();
  const r = view.report;
  if (!r) return <Processing view={view} kind="apply" />;
  const brought = r.entities.filter((e) => e.count > 0).map((e) => countOf(t, e.count, e.label));
  const skippedTotal = r.skipped.reduce((n, s) => n + s.count, 0);
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Your data is ready')}</h1>
        <p className="text-muted-foreground">
          {t('Here’s what we brought in, and anything worth knowing.')}
        </p>
      </header>
      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm">
          <p className="flex gap-3" data-testid="report-brought-in">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <Bold text={t('{records} brought in.')}>{brought.join(', ')}</Bold>
            </span>
          </p>
          {skippedTotal > 0 ? (
            <p className="flex gap-3">
              <SkipForward className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {t.plural(
                  skippedTotal,
                  '{n} line skipped ({details}).',
                  '{n} lines skipped ({details}).',
                  {
                    details: r.skipped
                      .map((s) => `${t.text(s.label).toLowerCase()}: ${fmt.format(s.count)}`)
                      .join(', '),
                  },
                )}
              </span>
            </p>
          ) : null}
          {r.warnings.map((w) => (
            <p key={w} className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                {t.text(w)} {t('We kept these records and marked what’s missing.')}
              </span>
            </p>
          ))}
          {r.assumptions.length > 0 ? (
            <details className="group">
              <summary className="flex cursor-pointer gap-3">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{t('Things we assumed ({n})', { n: r.assumptions.length })}</span>
              </summary>
              <ul className="mt-2 grid list-disc gap-1 pl-12 text-muted-foreground">
                {r.assumptions.map((a) => (
                  <li key={a}>{t.text(a)}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={`/w/${slug}/dashboard`}>{t('See my dashboard')}</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={`/w/${slug}/data`}>{t('Go to my data')}</Link>
        </Button>
      </div>
    </div>
  );
}

/** After a re-upload: what changed, with "Undo this update". */
function UpdateReport({
  slug,
  view,
  onUndone,
}: {
  slug: string;
  view: ImportView;
  onUndone: () => void;
}) {
  const t = useT();
  const editor = useCanChange();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const r = view.report;
  if (!r) return <Processing view={view} kind="merge" />;
  const label = new Map(r.entities.map((e) => [e.key, e.label]));
  const lines = (r.merge ?? [])
    .filter((m) => m.inserted + m.updated > 0)
    .map((m) => {
      const l = label.get(m.entity) ?? { singular: m.entity, plural: m.entity };
      const name = (n: number) => t.text(n === 1 ? l.singular : l.plural).toLowerCase();
      return [
        m.inserted > 0
          ? t.plural(m.inserted, '{n} new {record}', '{n} new {records}', {
              record: name(m.inserted),
              records: name(m.inserted),
            })
          : null,
        m.updated > 0
          ? t.plural(m.updated, '{n} {record} updated', '{n} {records} updated', {
              record: name(m.updated),
              records: name(m.updated),
            })
          : null,
      ]
        .filter(Boolean)
        .join(', ');
    });
  const kept = (r.merge ?? []).reduce((n, m) => n + m.missing, 0);
  const undo = () =>
    startTransition(async () => {
      setError(null);
      const res = await undoImport(slug, view.runId);
      if (res.error) setError(res.error);
      else onUndone();
    });
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.undone ? t('This update was undone') : t('Your data is up to date')}
        </h1>
        <p className="text-muted-foreground">
          {view.undone
            ? t('Your records are back to how they were before these files.')
            : t('Your dashboard and answers now include the new files.')}
        </p>
      </header>
      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm" data-testid="update-report">
          {lines.length > 0 ? (
            lines.map((l) => (
              <p
                key={l}
                className={cn('flex gap-3', view.undone && 'text-muted-foreground line-through')}
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>{l}.</span>
              </p>
            ))
          ) : (
            <p>{t('Nothing needed changing.')}</p>
          )}
          {kept > 0 && !view.undone ? (
            <p className="flex gap-3 text-muted-foreground">
              <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t.plural(
                  kept,
                  '{n} record wasn’t in the new files. We kept it.',
                  '{n} records weren’t in the new files. We kept them.',
                )}
              </span>
            </p>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={`/w/${slug}/dashboard`}>{t('See my dashboard')}</Link>
        </Button>
        {!view.undone && lines.length > 0 && editor ? (
          <Button size="lg" variant="outline" disabled={pending} onClick={undo}>
            {pending ? <Loader2 className="animate-spin" /> : <Undo2 />} {t('Undo this update')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
