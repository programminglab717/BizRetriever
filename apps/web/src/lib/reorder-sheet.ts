import 'server-only';

import type { Sheet } from '@bizr/core/export';
import type { ReorderList } from '@bizr/core/planning';
import { makeTranslator, type Translator } from '@bizr/i18n/translate';

const english = makeTranslator('en', {});

/** The reorder list as a download: one row per product, grouped by supplier. */
export function reorderSheet(list: ReorderList, t: Translator = english): Sheet {
  return {
    name: t('Reorder list'),
    columns: [
      { label: t('Supplier'), type: 'text' },
      { label: t('Product'), type: 'text' },
      { label: t('In stock'), type: 'number' },
      { label: t('Sold per day (last 28 days)'), type: 'number' },
      { label: t('Days of stock left'), type: 'number' },
      { label: t('Lead time (days)'), type: 'number' },
      { label: t('Sold in these weeks last year'), type: 'number' },
      { label: t('Suggested order'), type: 'number' },
      { label: t('May run out before it arrives'), type: 'text' },
    ],
    rows: [...list.lines]
      .sort(
        (a, b) =>
          (a.supplier ?? '￿').localeCompare(b.supplier ?? '￿') || a.daysOfCover - b.daysOfCover,
      )
      .map((l) => [
        l.supplier ?? t('No supplier recorded'),
        l.product,
        l.onHand,
        Math.round(l.perDay * 100) / 100,
        Number.isFinite(l.daysOfCover) ? Math.round(l.daysOfCover) : null,
        l.leadDays,
        l.lastYear,
        l.suggested,
        l.soon ? t('Yes') : t('No'),
      ]),
  };
}
