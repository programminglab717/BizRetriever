'use client';

import type { RecordDetail, RecordRow } from '@bizr/core/records';
import { FileSpreadsheet, History, Link2, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { openRecord } from '@/app/w/[slug]/data/[entity]/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { FieldEditor } from './field-editor';
import { formatValue } from './format';

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
/** Postgres `timestamptz::text` ("2026-10-16 13:58:41.12+00") → a Date. */
const pgTime = (s: string) => new Date(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));

/** The record side panel: every detail (editable), linked records, where it came from, history. */
export function RecordPanel({
  slug,
  entity,
  recordId,
  currency,
  version,
  editing,
  onEdit,
  onSave,
  onDelete,
  onRestore,
  onClose,
}: {
  slug: string;
  entity: string;
  recordId: string;
  currency: string;
  /** Changes when the record was saved, so the panel reloads its history. */
  version: number;
  editing: { field: string; error: string | null; busy: boolean } | null;
  onEdit: (field: string | null) => void;
  onSave: (row: RecordRow, field: string, value: string | boolean | null) => void;
  onDelete: (row: RecordRow) => void;
  onRestore: (row: RecordRow) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let stale = false;
    void openRecord(slug, entity, recordId).then((r) => {
      if (stale) return;
      if (r.ok) {
        setDetail(r.data);
        setError(null);
      } else setError(r.error);
    });
    return () => {
      stale = true;
    };
  }, [slug, entity, recordId, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  const row = detail?.record;
  const deleted = Boolean(row?.deletedAt);
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={row?.title ?? 'Record'}
      data-testid="record-panel"
      className="fixed inset-0 z-40 flex flex-col bg-background shadow-xl md:inset-y-0 md:right-0 md:left-auto md:w-[28rem] md:border-l"
    >
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="grid gap-0.5">
          <p className="text-xs text-muted-foreground">{detail?.entity.label.singular}</p>
          <h2 className="text-lg font-semibold">{row?.title ?? 'Loading…'}</h2>
          {deleted ? <p className="text-xs text-destructive">Deleted</p> : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="grid flex-1 content-start gap-6 overflow-y-auto p-4 text-sm">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!detail && !error ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : null}
        {detail && row ? (
          <>
            <dl className="grid gap-3">
              {detail.entity.fields.map((f) => {
                const isEditing = editing?.field === f.key;
                const shown = formatValue(f, row.values[f.key] ?? null, currency);
                return (
                  <div key={f.key} className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd>
                      {isEditing ? (
                        <FieldEditor
                          slug={slug}
                          field={f}
                          value={row.values[f.key] ?? null}
                          linkTitle={row.values[f.key] ?? null}
                          error={editing.error}
                          busy={editing.busy}
                          onSave={(v) => onSave(row, f.key, v)}
                          onCancel={() => onEdit(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={deleted}
                          aria-label={`Change ${f.label.toLowerCase()}`}
                          onClick={() => onEdit(f.key)}
                          className="w-full rounded-md px-2 py-1.5 -mx-2 text-left hover:bg-muted disabled:hover:bg-transparent"
                        >
                          {shown || <span className="text-muted-foreground">Not recorded</span>}
                        </button>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>

            {detail.linked.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="flex items-center gap-2 font-medium">
                  <Link2 className="size-4" aria-hidden /> Linked records
                </h3>
                {detail.linked.map((l) => (
                  <div key={`${l.entity}.${l.field}`} className="grid gap-1.5">
                    <Link
                      className="text-primary hover:underline"
                      href={
                        `/w/${slug}/data/${l.entity}?f=${l.field}:${row.id}&with=${encodeURIComponent(row.title)}` as Route
                      }
                    >
                      {l.count} {(l.count === 1 ? l.label.singular : l.label.plural).toLowerCase()}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      {l.examples.map((x) => (
                        <Link
                          key={x.id}
                          href={`/w/${slug}/data/${l.entity}?open=${x.id}` as Route}
                          className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted"
                        >
                          {x.title}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            <section className="grid gap-1">
              <h3 className="flex items-center gap-2 font-medium">
                <FileSpreadsheet className="size-4" aria-hidden /> Where this came from
              </h3>
              <p className="text-muted-foreground" data-testid="record-source">
                {detail.source
                  ? [
                      detail.source.fileName,
                      detail.source.sheet,
                      detail.source.row ? `row ${detail.source.row}` : null,
                    ]
                      .filter(Boolean)
                      .join(' › ')
                  : 'Added here in BizRetriever.'}
              </p>
            </section>

            <section className="grid gap-2">
              <h3 className="flex items-center gap-2 font-medium">
                <History className="size-4" aria-hidden /> History
              </h3>
              <ol className="grid gap-2" data-testid="record-history">
                {detail.history.map((h, i) => (
                  <li
                    key={i}
                    className={cn('grid gap-0.5', h.undone && 'text-muted-foreground line-through')}
                  >
                    <span>{historyText(h, detail, currency)}</span>
                    <span className="text-xs text-muted-foreground">
                      {[h.by, when.format(pgTime(h.at)), h.undone ? 'undone' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
                <li className="grid gap-0.5">
                  <span>
                    Brought in{detail.source?.fileName ? ` from ${detail.source.fileName}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {when.format(pgTime(detail.createdAt))}
                  </span>
                </li>
              </ol>
            </section>
          </>
        ) : null}
      </div>
      {row ? (
        <footer className="flex flex-wrap items-center gap-2 border-t p-4">
          {deleted ? (
            <Button onClick={() => onRestore(row)}>
              <RotateCcw /> Restore
            </Button>
          ) : confirming ? (
            <>
              <span className="mr-auto text-sm">
                Delete this {detail?.entity.label.singular.toLowerCase()}? You can restore it for 30
                days.
              </span>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirming(false);
                  onDelete(row);
                }}
              >
                Delete
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              <Trash2 /> Delete
            </Button>
          )}
        </footer>
      ) : null}
    </aside>
  );
}

function historyText(
  h: RecordDetail['history'][number],
  detail: RecordDetail,
  currency: string,
): string {
  const how =
    h.origin === 'reupload' ? ' from a newer file' : h.origin === 'chat' ? ' by chat' : '';
  if (h.op === 'insert') return `Added${how}`;
  if (h.op === 'delete') return `Deleted${how}`;
  if (h.op === 'restore') return `Restored${how}`;
  const parts = h.changes.map((c) => {
    const f = detail.entity.fields.find((x) => x.key === c.field);
    const fmt = (v: string | null) =>
      (f && f.type !== 'reference' ? formatValue(f, v, currency) : v) || 'blank';
    return `${c.label} ${fmt(c.from)} → ${fmt(c.to)}`;
  });
  return `Changed ${parts.join(', ') || 'details'}${how}`;
}
