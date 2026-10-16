'use client';

import type { DashboardView, EditOp } from '@bizr/core/dashboard';
import { Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { editAction, saveRangeAction, undoAction } from '@/app/w/[slug]/dashboard/actions';
import type { NumberStyle } from '@/components/ask/answer-chart';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { DashboardTile } from './dashboard-tile';
import { EditBox } from './edit-box';

export interface RangeOption {
  preset: string;
  label: string;
}

interface Toast {
  text: string;
  undo?: boolean;
}

/** The dashboard: date range and comparison, the tiles, chat and menu edits, undo. */
export function DashboardBoard({
  slug,
  view,
  presets,
  style,
}: {
  slug: string;
  view: DashboardView;
  presets: RangeOption[];
  style: NumberStyle;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const preset = 'preset' in view.range.range ? view.range.range.preset : 'custom';
  const setRange = (next: { preset?: string; compare?: boolean }) => {
    const p = next.preset ?? preset;
    const compare = next.compare ?? view.range.compare;
    const range = { range: { preset: p }, compare } as DashboardView['range'];
    start(async () => {
      await saveRangeAction(slug, range);
      router.push(`/w/${slug}/dashboard?range=${p}&compare=${compare ? 1 : 0}` as Route);
    });
  };

  const edit = (ops: EditOp[]) =>
    start(async () => {
      setError(null);
      const r = await editAction(slug, ops);
      if (!r.ok) return setError(r.error);
      setToast({ text: `${r.changes.join('. ')}.`, undo: true });
      router.refresh();
    });
  const undo = () =>
    start(async () => {
      const r = await undoAction(slug);
      if (!r.ok) return setError(r.error);
      setToast({ text: 'Undone.' });
      router.refresh();
    });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Dates</span>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={preset}
            disabled={pending}
            onChange={(e) => setRange({ preset: e.target.value })}
            aria-label="Date range"
          >
            {presets.map((p) => (
              <option key={p.preset} value={p.preset}>
                {p.label}
              </option>
            ))}
            {preset === 'custom' && <option value="custom">{view.rangeLabel}</option>}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={view.range.compare}
            disabled={pending}
            onChange={(e) => setRange({ compare: e.target.checked })}
          />
          Compare with the period before
        </label>
        <span className="text-sm text-muted-foreground" data-testid="range-label">
          {view.rangeLabel}
        </span>
        {view.canUndo && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={pending} onClick={undo}>
            <Undo2 /> Undo last change
          </Button>
        )}
      </div>

      <EditBox
        slug={slug}
        style={style}
        disabled={pending}
        onApplied={(changes) => {
          setToast({ text: `${changes.join('. ')}.`, undo: true });
          router.refresh();
        }}
      />

      {error && <Alert tone="error">{error}</Alert>}

      {view.unlock.length > 0 && (
        <section className="rounded-xl border border-dashed p-4 text-sm" data-testid="unlock-card">
          <h2 className="font-medium">Unlock more</h2>
          <ul className="mt-1 grid gap-1 text-muted-foreground">
            {view.unlock.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={`/w/${slug}/data/import`}>Add a file</Link>
          </Button>
        </section>
      )}

      <div
        className={`grid gap-4 md:grid-cols-12 ${pending ? 'opacity-70' : ''}`}
        aria-busy={pending}
      >
        {view.tiles.map((t, i) => (
          <DashboardTile
            key={t.id}
            slug={slug}
            tile={t}
            style={style}
            first={i === 0}
            last={i === view.tiles.length - 1}
            busy={pending}
            onEdit={(op) => edit([op])}
          />
        ))}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg md:right-6 md:bottom-6 md:left-auto"
        >
          <span className="flex-1">{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                setToast(null);
                undo();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
