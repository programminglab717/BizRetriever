import 'server-only';

import type { Sheet } from '@bizr/core/export';
import type { ReorderList } from '@bizr/core/planning';

/** The reorder list as a download: one row per product, grouped by supplier. */
export function reorderSheet(list: ReorderList): Sheet {
  return {
    name: 'Reorder list',
    columns: [
      { label: 'Supplier', type: 'text' },
      { label: 'Product', type: 'text' },
      { label: 'In stock', type: 'number' },
      { label: 'Sold per day (last 28 days)', type: 'number' },
      { label: 'Days of stock left', type: 'number' },
      { label: 'Lead time (days)', type: 'number' },
      { label: 'Suggested order', type: 'number' },
      { label: 'May run out before it arrives', type: 'text' },
    ],
    rows: [...list.lines]
      .sort(
        (a, b) =>
          (a.supplier ?? '￿').localeCompare(b.supplier ?? '￿') || a.daysOfCover - b.daysOfCover,
      )
      .map((l) => [
        l.supplier ?? 'No supplier recorded',
        l.product,
        l.onHand,
        Math.round(l.perDay * 100) / 100,
        Math.round(l.daysOfCover),
        l.leadDays,
        l.suggested,
        l.soon ? 'Yes' : 'No',
      ]),
  };
}
