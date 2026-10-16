'use client';

import type { ChartType } from '@bizr/core/ask';
import type { EditOp, TileView } from '@bizr/core/dashboard';
import { CalendarDays, MoreVertical } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  AnswerChart,
  AnswerTable,
  KpiCards,
  type NumberStyle,
} from '@/components/ask/answer-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const CHART_NAMES: Record<ChartType, string> = {
  kpi: 'Number',
  line: 'Line chart',
  bar: 'Bar chart',
  bar_horizontal: 'Bar chart (sideways)',
  stacked_bar: 'Stacked bars',
  table: 'Table',
};

/** Rows of height on desktop, as a minimum height (tiles grow to fit). */
const ROW_PX = 72;

/** A dashboard tile: its question re-run for the dashboard's dates, with a ⋮ menu for changes. */
export function DashboardTile({
  slug,
  tile,
  style,
  first,
  last,
  busy,
  onEdit,
}: {
  slug: string;
  tile: TileView;
  style: NumberStyle;
  first: boolean;
  last: boolean;
  busy: boolean;
  onEdit: (op: EditOp) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tile.title);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const [w, h] = tile.size;
  const act = (op: EditOp) => {
    setMenu(false);
    onEdit(op);
  };
  const empty = !tile.error && (!tile.table || tile.table.rows.length === 0);

  return (
    <Card
      data-testid="dashboard-tile"
      className="min-w-0 md:[grid-column:span_var(--w)/span_var(--w)]"
      style={{ ['--w' as string]: String(w), minHeight: `${h * ROW_PX}px` }}
    >
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              if (name.trim() && name.trim() !== tile.title)
                onEdit({ op: 'update_tile', tileId: tile.id, title: name.trim() });
            }}
          >
            <label className="sr-only" htmlFor={`name-${tile.id}`}>
              New name for {tile.title}
            </label>
            <Input
              id={`name-${tile.id}`}
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        ) : (
          <CardTitle className="flex items-center gap-2 text-base">
            {tile.title}
            {tile.fixedDates && (
              <span
                className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
                title="Keeps its own dates"
              >
                <CalendarDays className="size-3.5" aria-hidden />
                {tile.datesLabel}
              </span>
            )}
          </CardTitle>
        )}
        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`Options for ${tile.title}`}
            aria-expanded={menu}
            disabled={busy}
            onClick={() => setMenu((m) => !m)}
          >
            <MoreVertical />
          </Button>
          {menu && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 grid w-56 gap-0.5 rounded-md border bg-background p-1 text-sm shadow-lg"
            >
              <MenuItem onClick={() => (setMenu(false), setRenaming(true))}>Rename</MenuItem>
              {(tile.charts ?? [])
                .filter((c) => c !== tile.chart)
                .map((c) => (
                  <MenuItem
                    key={c}
                    onClick={() => act({ op: 'update_tile', tileId: tile.id, chart: c })}
                  >
                    Show as {CHART_NAMES[c].toLowerCase()}
                  </MenuItem>
                ))}
              {w < 12 && (
                <MenuItem
                  onClick={() =>
                    act({ op: 'update_tile', tileId: tile.id, size: [Math.min(12, w + 3), h] })
                  }
                >
                  Make wider
                </MenuItem>
              )}
              {w > 3 && (
                <MenuItem
                  onClick={() =>
                    act({ op: 'update_tile', tileId: tile.id, size: [Math.max(3, w - 3), h] })
                  }
                >
                  Make narrower
                </MenuItem>
              )}
              {!first && (
                <MenuItem
                  onClick={() => act({ op: 'move_tile', tileId: tile.id, position: 'top' })}
                >
                  Move to top
                </MenuItem>
              )}
              {!last && (
                <MenuItem
                  onClick={() => act({ op: 'move_tile', tileId: tile.id, position: 'bottom' })}
                >
                  Move to bottom
                </MenuItem>
              )}
              {tile.fixedDates && (
                <MenuItem
                  onClick={() => act({ op: 'update_tile', tileId: tile.id, fixedDates: false })}
                >
                  Follow dashboard dates
                </MenuItem>
              )}
              <Link
                role="menuitem"
                className="rounded px-3 py-2 hover:bg-accent"
                href={`/w/${slug}/ask?q=${encodeURIComponent(tile.title)}`}
              >
                Ask about this
              </Link>
              <MenuItem destructive onClick={() => act({ op: 'remove_tile', tileId: tile.id })}>
                Remove
              </MenuItem>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {tile.error ? (
          <p className="text-sm text-muted-foreground">{tile.error}</p>
        ) : empty ? (
          <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        ) : tile.chart === 'kpi' && tile.kpis?.length ? (
          <KpiCards
            compact
            title={tile.title}
            kpis={tile.kpis}
            {...(tile.comparedWith ? { comparedWith: tile.comparedWith } : {})}
          />
        ) : tile.chart === 'table' ? (
          <AnswerTable table={tile.table!} caption={tile.title} />
        ) : (
          <AnswerChart chart={tile.chart} table={tile.table!} title={tile.title} style={style} />
        )}
        {tile.note && !tile.error && (
          <p className="mt-2 text-xs text-muted-foreground">{tile.note}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MenuItem({
  children,
  onClick,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`rounded px-3 py-2 text-left hover:bg-accent ${destructive ? 'text-destructive' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
