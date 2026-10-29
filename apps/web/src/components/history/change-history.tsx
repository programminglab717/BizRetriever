'use client';

import type { UndoPreview } from '@bizr/core/structure';
import { AlertTriangle, FileUp, Loader2, Shapes, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { checkUndo, undoChange } from '@/app/w/[slug]/history/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCanChange } from '@/components/shell/can-change';

export type HistoryItem = {
  key: string;
  at: string;
  by: string | null;
  lines: string[];
  destructive: boolean;
  undone: boolean;
  canUndo: boolean;
} & ({ kind: 'structure'; version: number } | { kind: 'import'; runId: string });

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function ChangeHistory({ slug, items }: { slug: string; items: HistoryItem[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editor = useCanChange();
  const [confirm, setConfirm] = useState<UndoPreview | null>(null);

  const undo = (version: number, confirmed: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await undoChange(slug, version, confirmed);
      if (!r.ok) return setError(r.error);
      setConfirm(null);
      router.refresh();
    });
  const start = (version: number) =>
    startTransition(async () => {
      setError(null);
      const r = await checkUndo(slug, version);
      if (!r.ok) return setError(r.error);
      // Undoing that loses nothing happens straight away; anything else is explained first.
      if (r.data.needsConfirmation) setConfirm(r.data);
      else undo(version, false);
    });

  if (items.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {t(
          'Nothing has changed yet. Changes to what you track and updates from your files will show here.',
        )}
      </p>
    );
  return (
    <div className="grid gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {confirm ? (
        <div
          role="alertdialog"
          aria-labelledby="undo-title"
          className="grid gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30"
        >
          <h2 id="undo-title" className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 text-amber-600" aria-hidden />{' '}
            {t('Before you undo this')}
          </h2>
          <ul className="grid list-disc gap-1 pl-5">
            {confirm.warnings.map((w) => (
              <li key={w}>{t.text(w)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => undo(confirm.version, true)}>
              {pending ? <Loader2 className="animate-spin" /> : <Undo2 />} {t('Undo anyway')}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>
              {t('Keep the change')}
            </Button>
          </div>
        </div>
      ) : null}
      <ol className="grid gap-3" data-testid="change-history">
        {items.map((item) => (
          <li
            key={item.key}
            className={cn(
              'flex gap-3 rounded-xl border p-4 text-sm',
              item.undone && 'text-muted-foreground',
            )}
          >
            {item.kind === 'import' ? (
              <FileUp className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <Shapes className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <div className="grid flex-1 gap-1">
              {item.lines.map((l) => (
                <p key={l} className={cn(item.undone && 'line-through')}>
                  {t.text(l)}
                </p>
              ))}
              <p className="text-xs text-muted-foreground">
                {[item.by, when.format(new Date(item.at)), item.undone ? t('undone') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {item.canUndo && editor ? (
              item.kind === 'structure' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => start(item.version)}
                >
                  <Undo2 /> {t('Undo')}
                </Button>
              ) : (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/w/${slug}/data/import/${item.runId}` as Route}>
                    <Undo2 /> {t('Undo')}
                  </Link>
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
