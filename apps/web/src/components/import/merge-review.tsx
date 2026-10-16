'use client';

import type { MergePreview } from '@bizr/core/merge';
import { FileCheck2, Info, PencilLine, Plus, Sparkles } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cancelImport, mergeImport } from '@/app/w/[slug]/data/import/[runId]/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const fmt = new Intl.NumberFormat('en-US');
const count = (n: number, label: { singular: string; plural: string }) =>
  `${fmt.format(n)} ${(n === 1 ? label.singular : label.plural).toLowerCase()}`;

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
          {nothing ? 'Nothing new in these files' : 'Here’s what would change'}
        </h1>
        <p className="text-muted-foreground">
          {nothing
            ? 'Everything in these files is already in your data.'
            : 'Nothing is changed until you choose “Update my data”. You can undo the update afterwards.'}
        </p>
      </header>

      {preview.matches.length > 0 ? (
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm" data-testid="merge-matches">
            {preview.matches.map((m) => (
              <p key={m.sourceId} className="flex gap-3">
                <FileCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  This looks like a newer version of <strong>{m.label}</strong>. We read it the same
                  way as last time.
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {entities.map((e) => (
        <Card key={e.entity} data-testid={`merge-${e.entity}`}>
          <CardHeader>
            <CardTitle className="text-lg">{e.label.plural}</CardTitle>
            <CardDescription>
              {[
                e.new > 0 ? `${fmt.format(e.new)} new` : null,
                e.changed > 0 ? `${fmt.format(e.changed)} updated` : null,
                e.unchanged > 0 ? `${fmt.format(e.unchanged)} unchanged` : null,
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
                  <strong>{count(e.new, e.label)}</strong> will be added.
                  {e.unkeyedNew > 0
                    ? ` ${fmt.format(e.unkeyedNew)} of these have nothing that identifies them (like an order number), so we can’t tell whether they’re already in your data.`
                    : ''}
                </span>
              </p>
            ) : null}
            {e.changed > 0 ? (
              <div className="flex gap-3">
                <PencilLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="grid gap-1">
                  <span>
                    <strong>{count(e.changed, e.label)}</strong> will be updated, for example:
                  </span>
                  <ul className="grid list-disc gap-0.5 pl-5 text-muted-foreground">
                    {e.changeExamples.map((x) => (
                      <li key={x}>{x}</li>
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
                    <strong>{count(e.missing, e.label)}</strong> from last time aren’t in the new
                    files. We’ll keep them, so nothing is lost.
                  </span>
                  {e.missingExamples.length > 0 ? (
                    <span className="text-muted-foreground">
                      For example: {e.missingExamples.join(', ')}.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {e.duplicates > 0 ? (
              <p className="text-muted-foreground">
                {fmt.format(e.duplicates)} appear more than once in the new files; we used the first
                one each time.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {conflicts.length > 0 ? (
        <Card data-testid="merge-conflicts">
          <CardHeader>
            <CardTitle className="text-lg">You changed some of these here</CardTitle>
            <CardDescription>
              The new files say something different. Choose which to keep. If you don’t choose, we
              keep yours.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {conflicts.map((c) => {
              const choice = choices[c.key] ?? 'mine';
              return (
                <fieldset key={c.key} className="grid gap-2 rounded-lg border p-3">
                  <legend className="px-1 font-medium">
                    {c.record}: {c.fieldLabel.toLowerCase()}
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
                          {side === 'mine' ? 'Keep yours' : 'Take the file’s'}:{' '}
                          <strong>{(side === 'mine' ? c.mine : c.theirs) ?? 'blank'}</strong>
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
            Done
          </Button>
        ) : (
          <>
            <Button size="lg" disabled={pending} onClick={merge}>
              <Sparkles /> Update my data
            </Button>
            <Button size="lg" variant="ghost" disabled={pending} onClick={cancel}>
              Don’t update
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
