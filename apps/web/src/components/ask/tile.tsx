'use client';

import type { TileView } from '@bizr/core/ask';
import { CalendarDays } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { AnswerChart, AnswerTable, KpiCards, type NumberStyle } from './answer-chart';

/** A dashboard tile: its pinned question re-run with today's data. */
export function DashboardTile({ tile, style }: { tile: TileView; style: NumberStyle }) {
  return (
    <Card data-testid="dashboard-tile" className={tile.chart === 'kpi' ? '' : 'md:col-span-2'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {tile.title}
          {tile.fixedDates && (
            <CalendarDays className="size-4 text-muted-foreground" aria-label="Fixed dates" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tile.error ? (
          <p className="text-sm text-muted-foreground">{tile.error}</p>
        ) : !tile.table || tile.table.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        ) : tile.chart === 'kpi' && tile.kpis?.length ? (
          <KpiCards kpis={tile.kpis} />
        ) : tile.chart === 'table' ? (
          <AnswerTable table={tile.table} caption={tile.title} />
        ) : (
          <AnswerChart chart={tile.chart} table={tile.table} title={tile.title} style={style} />
        )}
      </CardContent>
    </Card>
  );
}
