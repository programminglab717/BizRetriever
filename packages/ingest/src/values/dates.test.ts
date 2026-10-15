import { describe, expect, it } from 'vitest';

import { excelSerialToDate, parseDate } from './dates';

describe('parseDate', () => {
  it.each([
    ['2026-03-04', { date: '2026-03-04', format: 'ISO', ambiguous: false }],
    ['2026/3/4', { date: '2026-03-04', format: 'Y/M/D', ambiguous: false }],
    [
      '2026-03-04 14:22:10 -0400',
      {
        date: '2026-03-04',
        time: '14:22:10',
        offsetMinutes: -240,
        format: 'ISO',
        ambiguous: false,
      },
    ],
    [
      '2026-03-04T09:05:00Z',
      { date: '2026-03-04', time: '09:05:00', offsetMinutes: 0, format: 'ISO', ambiguous: false },
    ],
    ['25/03/2026', { date: '2026-03-25', format: 'D/M/Y', ambiguous: false }],
    ['03/25/2026', { date: '2026-03-25', format: 'M/D/Y', ambiguous: false }],
    ['4 Mar 26', { date: '2026-03-04', format: 'D MON Y', ambiguous: false }],
    ['04-Mar-2026', { date: '2026-03-04', format: 'D MON Y', ambiguous: false }],
    ['Tue, 4 March 2026', { date: '2026-03-04', format: 'D MON Y', ambiguous: false }],
    ['Mar 4 2026', { date: '2026-03-04', format: 'MON D Y', ambiguous: false }],
    ['March 4, 2026', { date: '2026-03-04', format: 'MON D Y', ambiguous: false }],
    ['3/4/26 2:30 pm', { date: '2026-03-04', time: '14:30:00', format: 'M/D/Y', ambiguous: true }],
    ['05/05/2026', { date: '2026-05-05', format: 'D/M/Y', ambiguous: false }],
  ])('parses %j', (input, expected) => {
    expect(parseDate(input)).toEqual(expected);
  });

  it('resolves ambiguous numeric dates with the workspace date order', () => {
    expect(parseDate('03/04/2026', { dateOrder: 'MDY' })).toMatchObject({
      date: '2026-03-04',
      ambiguous: true,
    });
    expect(parseDate('03/04/2026', { dateOrder: 'DMY' })).toMatchObject({
      date: '2026-04-03',
      ambiguous: true,
    });
  });

  it.each([
    '31/02/2026',
    '2026-13-01',
    '13/13/2026',
    'hello',
    '12',
    'Mar 32 2026',
    '2026-03-04 25:00',
    'TOTAL 2025',
  ])('rejects %j', (input) => {
    expect(parseDate(input)).toBeUndefined();
  });

  it('reads real date cells (as stored by Excel) in UTC', () => {
    expect(parseDate(new Date('2026-03-04T00:00:00Z'))).toEqual({
      date: '2026-03-04',
      format: 'CELL',
      ambiguous: false,
    });
    expect(parseDate(new Date('2026-03-04T14:22:00Z'))).toMatchObject({ time: '14:22:00' });
  });

  it('only treats numbers as Excel serial dates when allowed', () => {
    expect(parseDate(46085)).toBeUndefined();
    expect(parseDate(46085, { allowSerial: true })).toMatchObject({
      date: '2026-03-04',
      format: 'SERIAL',
    });
    expect(parseDate(42, { allowSerial: true })).toBeUndefined();
  });
});

describe('excelSerialToDate', () => {
  it('converts serials with times', () => {
    expect(excelSerialToDate(46085)).toEqual({ date: '2026-03-04' });
    expect(excelSerialToDate(46085.5)).toEqual({ date: '2026-03-04', time: '12:00:00' });
  });
});
