'use client';

import type { BrowseResult, FieldMeta, RecordRow } from '@bizr/core/records';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Search, Trash2, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  bringBack,
  loadRecords,
  removeRecords,
  saveEdit,
  undoChange,
} from '@/app/w/[slug]/data/[entity]/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useCanChange } from '@/components/shell/can-change';

import { FieldEditor } from './field-editor';
import { formatValue, isNumeric, valueLabel } from './format';
import { RecordPanel } from './record-panel';

const fmt = new Intl.NumberFormat('en-US');
const ROW_HEIGHT = 41;
const ARIA_SORT = { asc: 'ascending', desc: 'descending', none: 'none' } as const;

interface Query {
  search: string;
  filters: { field: string; value: string | null }[];
  deleted: boolean;
}
interface Editing {
  rowId: string;
  field: string;
  error: string | null;
  busy: boolean;
  /** Editing in the side panel rather than the grid. */
  inPanel: boolean;
}
interface Toast {
  text: string;
  undo?: { batchId: string; ids: string[] };
}

/**
 * My data → one record type (PRODUCT_SPEC §4.2): a spreadsheet-like grid on wide screens and a card
 * list on phones, with search, filter chips, sorting, inline edits, a side panel and undo.
 */
export function RecordsBrowser({
  slug,
  currency,
  initial,
  query,
}: {
  slug: string;
  currency: string;
  initial: BrowseResult;
  query: Query;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const entity = initial.entity;
  const editor = useCanChange();
  const [rows, setRows] = useState<RecordRow[]>(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [open, setOpen] = useState<string | null>(params.get('open'));
  const [panelVersion, setPanelVersion] = useState(0);
  const [search, setSearch] = useState(query.search);
  const scroller = useRef<HTMLDivElement>(null);

  // --- URL state (search, sort, filters, deleted) ------------------------------------------------
  const navigate = useCallback(
    (change: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      next.delete('open');
      change(next);
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}` as Route, { scroll: false });
    },
    [params, pathname, router],
  );
  useEffect(() => {
    if (search === query.search) return;
    const timer = setTimeout(
      () =>
        navigate((p) => {
          if (search.trim()) p.set('q', search.trim());
          else p.delete('q');
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, query.search, navigate]);

  const sortBy = (field: string) =>
    navigate((p) => {
      const dir = initial.sort === field && initial.dir === 'asc' ? 'desc' : 'asc';
      p.set('sort', field);
      p.set('dir', dir);
    });
  const setFilter = (field: string, value: string | undefined) =>
    navigate((p) => {
      const rest = p.getAll('f').filter((f) => !f.startsWith(`${field}:`));
      p.delete('f');
      for (const f of rest) p.append('f', f);
      if (value !== undefined) p.append('f', `${field}:${value}`);
      if (
        !rest.some((f) =>
          entity.fields.some((x) => x.type === 'reference' && f.startsWith(`${x.key}:`)),
        )
      )
        p.delete('with');
    });

  // --- Loading more as you scroll ---------------------------------------------------------------
  const loadMore = useCallback(async () => {
    if (loading || rows.length >= total) return;
    setLoading(true);
    const r = await loadRecords(slug, {
      entity: entity.key,
      ...(query.search ? { search: query.search } : {}),
      ...(initial.sort ? { sort: initial.sort } : {}),
      dir: initial.dir,
      filters: query.filters,
      deleted: query.deleted,
      offset: rows.length,
      limit: 100,
    });
    setLoading(false);
    if (r.ok) {
      setRows((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...r.data.rows.filter((x) => !seen.has(x.id))];
      });
      setTotal(r.data.total);
    } else setError(r.error);
  }, [loading, rows.length, total, slug, entity.key, query, initial.sort, initial.dir]);

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtual.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 20) void loadMore();
  }, [lastIndex, rows.length, loadMore]);

  // --- Writes -----------------------------------------------------------------------------------
  const replaceRows = (updated: RecordRow[]) =>
    setRows((prev) =>
      prev
        .map((r) => updated.find((u) => u.id === r.id) ?? r)
        // A record that moved between "live" and "deleted" leaves this list.
        .filter((r) => (query.deleted ? r.deletedAt !== null : r.deletedAt === null)),
    );

  const save = async (
    row: RecordRow,
    field: FieldMeta,
    value: string | boolean | null,
    inPanel: boolean,
  ) => {
    setEditing({ rowId: row.id, field: field.key, error: null, busy: true, inPanel });
    const r = await saveEdit(slug, { entity: entity.key, id: row.id, field: field.key, value });
    if (!r.ok) {
      setEditing({ rowId: row.id, field: field.key, error: r.error, busy: false, inPanel });
      return;
    }
    setEditing(null);
    if (r.data.record) replaceRows([r.data.record]);
    setPanelVersion((v) => v + 1);
    if (r.data.batchId)
      setToast({
        text: t('Saved {detail} for {title}.', {
          detail: t.text(field.label).toLowerCase(),
          title: row.title,
        }),
        undo: { batchId: r.data.batchId, ids: [row.id] },
      });
  };

  const remove = async (row: RecordRow) => {
    const r = await removeRecords(slug, { entity: entity.key, ids: [row.id] });
    if (!r.ok) return setError(r.error);
    setOpen(null);
    setRows((prev) => prev.filter((x) => x.id !== row.id));
    setTotal((n) => n - 1);
    if (r.data.batchId)
      setToast({
        text: t('Deleted {title}.', { title: row.title }),
        undo: { batchId: r.data.batchId, ids: [row.id] },
      });
  };

  const restore = async (row: RecordRow) => {
    const r = await bringBack(slug, { entity: entity.key, ids: [row.id] });
    if (!r.ok) return setError(r.error);
    setOpen(null);
    setRows((prev) => prev.filter((x) => x.id !== row.id));
    setTotal((n) => n - 1);
    if (r.data.batchId)
      setToast({
        text: t('Restored {title}.', { title: row.title }),
        undo: { batchId: r.data.batchId, ids: [row.id] },
      });
  };

  const undo = async (u: NonNullable<Toast['undo']>) => {
    setToast(null);
    const r = await undoChange(slug, entity.key, u.batchId, u.ids);
    if (!r.ok) return setError(r.error);
    // Edits come back in place; an undone delete or restore brings the record back to this list.
    const belongs = (x: RecordRow) => (query.deleted ? x.deletedAt !== null : x.deletedAt === null);
    const ids = new Set(rows.map((x) => x.id));
    const back = r.data.filter((x) => !ids.has(x.id) && belongs(x));
    const gone = rows.filter((x) => r.data.some((u2) => u2.id === x.id && !belongs(u2))).length;
    setRows(
      [...back, ...rows.map((x) => r.data.find((u2) => u2.id === x.id) ?? x)].filter(belongs),
    );
    setTotal((n) => n + back.length - gone);
    setPanelVersion((v) => v + 1);
    setToast({ text: t('Undone.') });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8_000);
    return () => clearTimeout(timer);
  }, [toast]);

  // --- Rendering --------------------------------------------------------------------------------
  const chipFields = entity.fields.filter(
    (f) => f.type === 'boolean' || (f.type === 'text' && f.allowedValues?.length),
  );
  const linkFilter = query.filters.find((f) =>
    entity.fields.some((x) => x.key === f.field && x.type === 'reference'),
  );
  const title = entity.fields.find((f) => f.key === entity.titleField);
  const columns = entity.fields.filter((f) => f.key !== entity.titleField);
  const cardFields = columns.slice(0, 3);
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtual.getTotalSize() - (items.at(-1)?.end ?? 0);
  const things = t.text(entity.label.plural).toLowerCase();
  const counted = t.text(total === 1 ? entity.label.singular : entity.label.plural).toLowerCase();

  const cell = (row: RecordRow, f: FieldMeta) => {
    const isEditing =
      editing && !editing.inPanel && editing.rowId === row.id && editing.field === f.key;
    const value = row.values[f.key] ?? null;
    if (isEditing)
      return (
        <FieldEditor
          slug={slug}
          field={f}
          value={value}
          linkTitle={value}
          error={editing.error}
          busy={editing.busy}
          onSave={(v) => void save(row, f, v, false)}
          onCancel={() => setEditing(null)}
        />
      );
    const shown = formatValue(f, value, currency, t);
    return (
      <button
        type="button"
        disabled={query.deleted || !editor}
        onClick={() =>
          setEditing({ rowId: row.id, field: f.key, error: null, busy: false, inPanel: false })
        }
        aria-label={t('Change {detail} of {title}', {
          detail: t.text(f.label).toLowerCase(),
          title: row.title,
        })}
        className={cn(
          'block w-full truncate rounded px-1 py-1 text-left hover:bg-muted disabled:hover:bg-transparent',
          isNumeric(f) && 'text-right tabular-nums',
          f.type === 'reference' && value && 'text-primary',
        )}
      >
        {shown || <span className="text-muted-foreground/60">—</span>}
      </button>
    );
  };

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <Link
          href={`/w/${slug}/data`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t('My data')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {query.deleted ? t('Recently deleted {things}', { things }) : t.text(entity.label.plural)}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="records-count">
          {query.deleted
            ? t('{count} {things} deleted in the last 30 days. Restore any of them.', {
                count: fmt.format(total),
                things: counted,
              })
            : `${fmt.format(total)} ${counted}`}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-56 flex-1 items-center md:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Search {things}', { things })}
            aria-label={t('Search {things}', { things })}
            className="h-9 w-full rounded-md border bg-background pr-2 pl-8 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        {chipFields.map((f) => {
          const active = query.filters.find((x) => x.field === f.key);
          const options = f.type === 'boolean' ? ['true', 'false'] : f.allowedValues!;
          return (
            <select
              key={f.key}
              aria-label={t('Filter by {detail}', { detail: t.text(f.label).toLowerCase() })}
              value={active ? (active.value ?? '') : '*'}
              onChange={(e) =>
                setFilter(f.key, e.target.value === '*' ? undefined : e.target.value)
              }
              className={cn(
                'h-9 rounded-full border bg-background px-3 text-sm',
                active && 'border-primary bg-primary/5 text-primary',
              )}
            >
              <option value="*">{t('{detail}: any', { detail: t.text(f.label) })}</option>
              {options.map((v) => (
                <option key={v} value={v}>
                  {t.text(f.label)}:{' '}
                  {f.type === 'boolean' ? (v === 'true' ? t('Yes') : t('No')) : valueLabel(f, v, t)}
                </option>
              ))}
            </select>
          );
        })}
        {linkFilter ? (
          <span className="flex h-9 items-center gap-1 rounded-full border border-primary bg-primary/5 px-3 text-sm text-primary">
            {t.text(entity.fields.find((x) => x.key === linkFilter.field)?.label ?? '')}:{' '}
            {params.get('with') ?? `#${linkFilter.value ?? ''}`}
            <button
              type="button"
              aria-label={t('Remove this filter')}
              onClick={() => setFilter(linkFilter.field, undefined)}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : null}
        <Link
          href={
            (query.deleted
              ? `/w/${slug}/data/${entity.key}`
              : `/w/${slug}/data/${entity.key}?deleted=1`) as Route
          }
          className="ml-auto flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {query.deleted ? (
            <>
              <ArrowLeft className="size-4" /> {t('Back to {things}', { things })}
            </>
          ) : (
            <>
              <Trash2 className="size-4" /> {t('Recently deleted')}
            </>
          )}
        </Link>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query.deleted
            ? t('Nothing was deleted in the last 30 days.')
            : query.search || query.filters.length
              ? t('Nothing matches. Try a different search or remove a filter.')
              : t('No {things} yet.', { things })}
        </p>
      ) : (
        <>
          {/* Wide screens: the grid. Only the rows in view are drawn. */}
          <div
            ref={scroller}
            className="hidden max-h-[70vh] overflow-auto rounded-xl border md:block"
            data-testid="records-grid"
          >
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr>
                  {[title, ...columns].map((f, i) =>
                    f ? (
                      <th
                        key={f.key}
                        scope="col"
                        aria-sort={ARIA_SORT[initial.sort === f.key ? initial.dir : 'none']}
                        className={cn(
                          'border-b px-2 py-2 text-left font-medium whitespace-nowrap',
                          i === 0 && 'sticky left-0 z-10 bg-muted',
                          isNumeric(f) && 'text-right',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => sortBy(f.key)}
                          aria-label={t('Sort by {detail}', {
                            detail: t.text(f.label).toLowerCase(),
                          })}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {t.text(f.label)}
                          {initial.sort === f.key ? (
                            initial.dir === 'asc' ? (
                              <ArrowUp className="size-3.5" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3.5" aria-hidden />
                            )
                          ) : null}
                        </button>
                      </th>
                    ) : (
                      <th
                        key="_title"
                        className="sticky left-0 z-10 border-b bg-muted px-2 py-2 text-left font-medium"
                      >
                        {t.text(entity.label.singular)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {padTop > 0 ? (
                  <tr aria-hidden style={{ height: padTop }}>
                    <td colSpan={columns.length + 1} />
                  </tr>
                ) : null}
                {items.map((v) => {
                  const row = rows[v.index]!;
                  return (
                    <tr key={row.id} data-testid="record-row" className="group">
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] max-w-64 border-b bg-background px-2 py-1 text-left font-medium group-hover:bg-muted/50"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setOpen(row.id);
                          }}
                          className="block w-full truncate rounded px-1 py-1 text-left text-primary hover:underline"
                        >
                          {row.title}
                        </button>
                      </th>
                      {columns.map((f) => (
                        <td
                          key={f.key}
                          className="max-w-72 border-b px-1 py-0.5 group-hover:bg-muted/30"
                        >
                          {cell(row, f)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {padBottom > 0 ? (
                  <tr aria-hidden style={{ height: padBottom }}>
                    <td colSpan={columns.length + 1} />
                  </tr>
                ) : null}
              </tbody>
            </table>
            {loading ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t('Loading more…')}
              </p>
            ) : null}
          </div>

          {/* Phones: cards; tap one to see and change everything. */}
          <ul className="grid gap-2 md:hidden" data-testid="records-cards">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpen(row.id)}
                  className="grid w-full gap-1 rounded-xl border p-3 text-left text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{row.title}</span>
                  {cardFields.map((f) => {
                    const shown = formatValue(f, row.values[f.key] ?? null, currency, t);
                    return shown ? (
                      <span key={f.key} className="text-muted-foreground">
                        {t.text(f.label)}: {shown}
                      </span>
                    ) : null;
                  })}
                </button>
              </li>
            ))}
            {rows.length < total ? (
              <li>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void loadMore()}
                  className="w-full rounded-xl border p-3 text-sm text-primary"
                >
                  {loading
                    ? t('Loading…')
                    : t('Show more ({n} left)', { n: fmt.format(total - rows.length) })}
                </button>
              </li>
            ) : null}
          </ul>
        </>
      )}

      {open ? (
        <RecordPanel
          slug={slug}
          entity={entity.key}
          recordId={open}
          currency={currency}
          version={panelVersion}
          editing={editing && editing.inPanel && editing.rowId === open ? editing : null}
          onEdit={(field) =>
            setEditing(
              field ? { rowId: open, field, error: null, busy: false, inPanel: true } : null,
            )
          }
          onSave={(row, field, value) => {
            const f = entity.fields.find((x) => x.key === field);
            if (f) void save(row, f, value, true);
          }}
          onDelete={(row) => void remove(row)}
          onRestore={(row) => void restore(row)}
          onClose={() => {
            setEditing(null);
            setOpen(null);
          }}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg md:right-6 md:bottom-6 md:left-auto"
        >
          <span className="flex-1">{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              className="font-medium underline"
              onClick={() => void undo(toast.undo!)}
            >
              {t('Undo')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
