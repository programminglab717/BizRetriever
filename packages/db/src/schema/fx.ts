import { char, date, numeric, primaryKey } from 'drizzle-orm/pg-core';

import { app } from './base';

/**
 * Daily reference exchange rates (M20, ADR-070), from the European Central Bank: how many units of
 * `currency` one euro bought that day. Shared by every business; not tenant data. Weekends and
 * holidays have no row (the day before is used).
 */
export const fxRate = app.table(
  'fx_rate',
  {
    day: date('day', { mode: 'string' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    perEur: numeric('per_eur', { precision: 18, scale: 8 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.currency] })],
);
export type FxRate = typeof fxRate.$inferSelect;
