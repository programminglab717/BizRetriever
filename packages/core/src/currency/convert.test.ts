import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { EntitySpec, MaterializeResult, MaterializedRecord } from '../ingestion/materialize';
import {
  conversionNotes,
  convertAmount,
  convertRecords,
  neededRates,
  rateBook,
  recordDay,
} from './convert';
import { parseEcbXml } from './ecb';

const xml = readFileSync(new URL('./testing/ecb-sample.xml', import.meta.url), 'utf8');
const book = rateBook(parseEcbXml(xml));

describe('parseEcbXml', () => {
  it('reads every day and currency in the ECB file', () => {
    const rows = parseEcbXml(xml);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ day: '2026-03-03', currency: 'USD', perEur: '1.0900' });
    expect(rows.find((r) => r.day === '2026-02-27' && r.currency === 'GBP')?.perEur).toBe(
      '0.83850',
    );
  });

  it('ignores anything that is not a rate', () => {
    expect(parseEcbXml('<Cube currency="USD" rate="1.1"/>')).toEqual([]); // no day yet
    expect(parseEcbXml('<Cube time="2026-01-02"><Cube currency="usd" rate="x"/></Cube>')).toEqual(
      [],
    );
  });
});

describe('convertAmount', () => {
  it('multiplies and divides exactly, to 4 places', () => {
    // 100 EUR in USD at 1.0900 per euro.
    expect(convertAmount('100', '1', '1.0900')).toBe('109.0000');
    // 109 USD back to EUR.
    expect(convertAmount('109', '1.0900', '1')).toBe('100.0000');
    // GBP → USD through the euro: 50 × 1.0900 ÷ 0.84200 = 64.72684…
    expect(convertAmount('50', '0.84200', '1.0900')).toBe('64.7268');
  });

  it('rounds half away from zero, refunds included', () => {
    expect(convertAmount('0.00005', '1', '1')).toBe('0.0001');
    expect(convertAmount('-0.00005', '1', '1')).toBe('-0.0001');
    expect(convertAmount('-12.5', '1', '1.0900')).toBe('-13.6250');
  });

  it('never goes through floats', () => {
    // 0.1 + 0.2 style noise would show up here.
    expect(convertAmount('1234567890123.1234', '1', '1')).toBe('1234567890123.1234');
    expect(convertAmount('0.3', '1', '3')).toBe('0.9000');
  });
});

describe('rateBook', () => {
  it('uses the day itself, else the latest day before it within a week', () => {
    expect(book.rate('USD', '2026-03-02')).toBe('1.0850');
    // A Saturday and Sunday borrow Friday's rate.
    expect(book.rate('USD', '2026-02-28')).toBe('1.0800');
    expect(book.rate('USD', '2026-03-01')).toBe('1.0800');
    expect(book.rate('USD', '2026-03-10')).toBe('1.0900'); // 7 days on
    expect(book.rate('USD', '2026-03-11')).toBeNull(); // 8 days: too old to use
    expect(book.rate('USD', '2026-02-26')).toBeNull(); // before anything published
  });

  it('knows a euro is a euro, and nothing about currencies it was not given', () => {
    expect(book.rate('EUR', '1999-01-01')).toBe('1');
    expect(book.rate('AED', '2026-03-02')).toBeNull();
  });
});

const sale: EntitySpec = {
  key: 'sale',
  label: { singular: 'Sale', plural: 'Sales' },
  naturalKeys: [['order_number']],
  fields: [
    { key: 'order_number', label: 'Order number', type: 'text', required: true, pii: false },
    { key: 'ordered_at', label: 'Order date', type: 'datetime', required: false, pii: false },
    { key: 'total', label: 'Total', type: 'money', required: false, pii: false },
    { key: 'shipping', label: 'Shipping', type: 'money', required: false, pii: false },
  ],
};

const record = (
  fields: MaterializedRecord['fields'],
  currencies?: Record<string, string>,
): MaterializedRecord => ({
  fields,
  refs: {},
  links: {},
  refAlternatives: {},
  refMatchOn: {},
  naturalKey: null,
  rowHash: 'h',
  lineage: [{ sourceId: 'f0:Orders', fileName: 'orders.csv', sheet: 'Orders', row: 2 }],
  ...(currencies ? { currencies } : {}),
});

const resultOf = (records: MaterializedRecord[]): MaterializeResult => ({
  entities: new Map([['sale', records]]),
  issues: [],
  skipped: [],
  stats: { sources: [], entities: {}, references: [] },
});

describe('convertRecords', () => {
  it('converts marked amounts at the rate for the record’s own date', () => {
    const r = resultOf([
      record(
        { order_number: 'A1', ordered_at: { kind: 'date', date: '2026-03-02' }, total: 100 },
        { total: 'EUR' },
      ),
      record(
        {
          order_number: 'A2',
          ordered_at: { kind: 'date', date: '2026-03-01' },
          total: 50,
          shipping: 5,
        },
        { total: 'GBP', shipping: 'GBP' },
      ),
      record({ order_number: 'A3', ordered_at: { kind: 'date', date: '2026-03-02' }, total: 20 }),
    ]);
    const summary = convertRecords(r, [sale], 'USD', book, '2026-03-03');
    const [a1, a2, a3] = r.entities.get('sale')!;
    expect(a1!.fields.total).toBe('108.5000'); // 100 × 1.0850
    expect(a2!.fields.total).toBe('64.4007'); // 50 × 1.0800 ÷ 0.83850 (Friday's rates)
    expect(a2!.fields.shipping).toBe('6.4401');
    expect(a3!.fields.total).toBe(20); // already in dollars: untouched
    expect(summary).toEqual({ converted: { EUR: 1, GBP: 2 }, missing: [] });
    expect(r.issues).toEqual([]);
  });

  it('leaves an amount empty, and says so, when no rate is published', () => {
    const r = resultOf([
      record(
        { order_number: 'B1', ordered_at: { kind: 'date', date: '2026-03-02' }, total: 367 },
        { total: 'AED' },
      ),
    ]);
    const summary = convertRecords(r, [sale], 'USD', book, '2026-03-03');
    expect(r.entities.get('sale')![0]!.fields.total).toBeNull();
    expect(summary.missing).toEqual([{ currency: 'AED', count: 1, firstDay: '2026-03-02' }]);
    expect(r.issues[0]).toMatchObject({
      code: 'unreadable_value',
      entity: 'sale',
      field: 'total',
      row: 2,
      message: expect.stringContaining(
        'no published exchange rate for AED on 2026-03-02',
      ) as string,
    });
  });

  it('uses today for records without a date, and lists the rates it needs', () => {
    const r = resultOf([record({ order_number: 'C1', total: 10 }, { total: 'EUR' })]);
    expect(recordDay(r.entities.get('sale')![0]!, sale, '2026-03-03')).toBe('2026-03-03');
    expect(neededRates(r, [sale], 'USD', '2026-03-03')).toEqual([
      { currency: 'USD', day: '2026-03-03' },
    ]);
    convertRecords(r, [sale], 'USD', book, '2026-03-03');
    expect(r.entities.get('sale')![0]!.fields.total).toBe('10.9000');
  });
});

describe('conversionNotes', () => {
  it('says what was converted and what was left empty', () => {
    expect(
      conversionNotes(
        {
          converted: { GBP: 2, EUR: 1_200 },
          missing: [{ currency: 'AED', count: 1, firstDay: '2026-03-02' }],
        },
        'USD',
      ),
    ).toEqual([
      '1,200 amounts in EUR, 2 amounts in GBP converted to USD at the European Central Bank’s rate for each record’s date.',
      '1 amount in AED left empty: there’s no published exchange rate for it (from 2026-03-02).',
    ]);
  });
});
