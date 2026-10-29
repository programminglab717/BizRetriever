'use client';

import type { MergePreview } from '@bizr/core/merge';
import type { Translator } from '@bizr/i18n/translate';
import { FileCheck2, Info, PencilLine, Plus, Sparkles } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

import { cancelImport, mergeImport } from '@/app/w/[slug]/data/import/[runId]/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const fmt = new Intl.NumberFormat('en-US');
/** "3 products": a count with the name of the kind of record (the name comes from the pack). */
export const countOf = (t: Translator, n: number, label: { singular: string; plural: string }) =>
  `${fmt.format(n)} ${t.text(n === 1 ? label.singular : label.plural).toLowerCase()}`;

/** A translated sentence with one value in bold, where the sentence's `{placeholder}` is. */
export function Bold({ text, children }: { text: string; children: ReactNode }) {
  const [before = '', after = ''] = text.split(/\{[a-zA-Z]\w*\}/);
  return (
    <>
      {before}
      <strong>{children}</strong>
      {after}
    </>
  );
}

/**
 * Re-upload, before anything is written: which files we recognised, what's new, what changed, what's
 * missing from the new files (kept), and the details the owner changed here that the file disagrees
 * with. "Update my data" applies it; nothing happens until then.
 */
export function MergeReview({
  slug,
  runId,
  preview,
  onMerged,
}: {
  slug: string;
  runId: string;
  preview: MergePreview;
  onMerged: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>({});

  const entities = preview.entities.filter(
    (e) => e.new + e.changed + e.missing + e.conflicts.length > 0,
  );
  const conflicts = preview.entities.flatMap((e) => e.conflicts);
  const nothing = entities.length === 0;

  const merge = () =>
    startTransition(async () => {
      setError(null);
      const r = await mergeImport(slug, runId, choices);
      if (r.error) setError(r.error);
      else onMerged();
    });
  const cancel = () =>
    startTransition(async () => {
      setError(null);
      const r = await cancelImport(slug, runId);
      if (r.error) setError(r.error);
      else router.push(`/w/${slug}/data` as Route);
    });

  return (
    <div className="grid gap-6" aria-busy={pending}>
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {nothing ? t('Nothing new in these files') : t('Here’s what would change')}
        </h1>
        <p className="text-muted-foreground">
          {nothing
            ? t('Everything in these files is already in your data.')
            : t(
                'Nothing is changed until you choose “Update my data”. You can undo the update afterwards.',
              )}
        </p>
      </header>

      {preview.matches.length > 0 ? (
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm" data-testid="merge-matches">
            {preview.matches.map((m) => (
              <p key={m.sourceId} className="flex gap-3">
                <FileCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  <Bold text={t('This looks like a newer version of {file}.')}>{m.label}</Bold>{' '}
                  {t('We read it the same way as last time.')}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {entities.map((e) => (
        <Card key={e.entity} data-testid={`merge-${e.entity}`}>
          <CardHeader>
            <CardTitle className="text-lg">{t.text(e.label.plural)}</CardTitle>
            <CardDescription>
              {[
                e.new > 0 ? t('{n} new', { n: e.new }) : null,
                e.changed > 0 ? t('{n} updated', { n: e.changed }) : null,
                e.unchanged > 0 ? t('{n} unchanged', { n: e.unchanged }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {e.new > 0 ? (
              <p className="flex gap-3">
                <Plus className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  <Bold text={t('{records} will be added.')}>{countOf(t, e.new, e.label)}</Bold>
                  {e.unkeyedNew > 0
                    ? ` ${t.plural(
                        e.unkeyedNew,
                        '1 of these have nothing that identifies them (like an order number), so we can’t tell whether they’re already in your data.',
                        '{n} of these have nothing that identifies them (like an order number), so we can’t tell whether they’re already in your data.',
                      )}`
                    : ''}
                </span>
              </p>
            ) : null}
            {e.changed > 0 ? (
              <div className="flex gap-3">
                <PencilLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="grid gap-1">
                  <span>
                    <Bold text={t('{records} will be updated, for example:')}>
                      {countOf(t, e.changed, e.label)}
                    </Bold>
                  </span>
                  <ul className="grid list-disc gap-0.5 pl-5 text-muted-foreground">
                    {e.changeExamples.map((x) => (
                      <li key={x}>{t.text(x)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
            {e.missing > 0 ? (
              <div className="flex gap-3">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="grid gap-1">
                  <span>
                    <Bold text={t('{records} from last time aren’t in the new files.')}>
                      {countOf(t, e.missing, e.label)}
                    </Bold>{' '}
                    {t('We’ll keep them, so nothing is lost.')}
                  </span>
                  {e.missingExamples.length > 0 ? (
                    <span className="text-muted-foreground">
                      {t('For example: {examples}.', { examples: e.missingExamples.join(', ') })}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {e.duplicates > 0 ? (
              <p className="text-muted-foreground">
                {t.plural(
                  e.duplicates,
                  '1 appear more than once in the new files; we used the first one each time.',
                  '{n} appear more than once in the new files; we used the first one each time.',
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {conflicts.length > 0 ? (
        <Card data-testid="merge-conflicts">
          <CardHeader>
            <CardTitle className="text-lg">{t('You changed some of these here')}</CardTitle>
            <CardDescription>
              {t(
                'The new files say something different. Choose which to keep. If you don’t choose, we keep yours.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {conflicts.map((c) => {
              const choice = choices[c.key] ?? 'mine';
              return (
                <fieldset key={c.key} className="grid gap-2 rounded-lg border p-3">
                  <legend className="px-1 font-medium">
                    {c.record}: {t.text(c.fieldLabel).toLowerCase()}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(['mine', 'theirs'] as const).map((side) => (
                      <label
                        key={side}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2',
                          choice === side && 'border-primary bg-primary/5',
                        )}
                      >
                        <input
                          type="radio"
                          name={c.key}
                          checked={choice === side}
                          onChange={() => setChoices((all) => ({ ...all, [c.key]: side }))}
                          disabled={pending}
                        />
                        <span>
                          {side === 'mine' ? t('Keep yours') : t('Take the file’s')}:{' '}
                          <strong>{(side === 'mine' ? c.mine : c.theirs) ?? t('blank')}</strong>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="sticky bottom-20 z-10 flex flex-wrap gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur md:bottom-4">
        {nothing ? (
          <Button size="lg" disabled={pending} onClick={cancel}>
            {t('Done')}
          </Button>
        ) : (
          <>
            <Button size="lg" disabled={pending} onClick={merge}>
              <Sparkles /> {t('Update my data')}
            </Button>
            <Button size="lg" variant="ghost" disabled={pending} onClick={cancel}>
              {t('Don’t update')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
