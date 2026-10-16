import { describe, expect, it } from 'vitest';

import {
  canonical,
  diffRecords,
  mergeWrites,
  type ExistingRecord,
  type IncomingRecord,
} from './diff';

const fields = [
  { key: 'name', type: 'text' as const },
  { key: 'price', type: 'money' as const },
  { key: 'stock', type: 'integer' as const },
  { key: 'launched', type: 'date' as const },
  { key: 'supplier', type: 'reference' as const },
];
const existing = (
  id: string,
  key: string | null,
  values: Record<string, unknown>,
  edited: string[] = [],
): ExistingRecord => ({
  id,
  naturalKey: key,
  rowHash: `h-${id}`,
  values,
  editedFields: new Set(edited),
  inScope: true,
});
const incoming = (
  key: string | null,
  values: Record<string, unknown>,
  rowHash = `n-${key}`,
): IncomingRecord => ({
  naturalKey: key,
  rowHash,
  values,
});

describe('canonical', () => {
  it('compares values by meaning, not by spelling', () => {
    expect(canonical('money', '12.5000')).toBe(canonical('money', 12.5));
    expect(canonical('money', '12.50')).toBe('12.5');
    expect(canonical('integer', '7')).toBe(canonical('integer', 7));
    expect(canonical('date', new Date(2026, 2, 1))).toBe('2026-03-01');
    expect(canonical('date', '2026-03-01')).toBe('2026-03-01');
    expect(canonical('text', '  Sage Mug ')).toBe('Sage Mug');
    expect(canonical('boolean', 'true')).toBe('true');
    expect(canonical('text', '')).toBeNull();
  });

  it('compares date-times as instants, whatever offset they are written in', () => {
    const stored = new Date('2025-10-15T06:53:58.000Z');
    expect(canonical('datetime', '2025-10-15T02:53:58-04:00')).toBe(canonical('datetime', stored));
    expect(canonical('datetime', '2025-10-15T12:23:58+0530')).toBe(canonical('datetime', stored));
    expect(canonical('datetime', '2025-10-15T06:53:58Z')).toBe(canonical('datetime', stored));
    expect(canonical('datetime', '2025-10-15T03:53:58-04:00')).not.toBe(
      canonical('datetime', stored),
    );
    // No offset: can't be placed here (the caller resolves it in the workspace time zone).
    expect(canonical('datetime', '2025-10-15T02:53:58')).toBe('2025-10-15T02:53:58');
  });
});

describe('diffRecords', () => {
  const now = [
    existing('1', 'MUG-1', {
      name: 'Sage Mug',
      price: '18.0000',
      stock: 10,
      launched: '2026-01-05',
      supplier: 'Hearth',
    }),
    existing(
      '2',
      'MUG-2',
      { name: 'Oat Mug', price: '18.0000', stock: 4, launched: null, supplier: 'Hearth' },
      ['price'],
    ),
    existing('3', 'CAN-1', {
      name: 'Fig Candle',
      price: '24.0000',
      stock: 0,
      launched: null,
      supplier: 'Wick',
    }),
    existing('4', 'OLD-1', {
      name: 'Old thing',
      price: '5.0000',
      stock: 1,
      launched: null,
      supplier: null,
    }),
  ];

  it('sorts records into new, changed, unchanged and missing, field by field', () => {
    const d = diffRecords(fields, now, [
      incoming('MUG-1', {
        name: 'Sage Mug',
        price: 18,
        stock: 7,
        launched: '2026-01-05',
        supplier: 'Hearth',
      }),
      incoming('CAN-1', {
        name: 'Fig Candle',
        price: '24.00',
        stock: 0,
        launched: null,
        supplier: 'Wick',
      }),
      incoming('NEW-1', {
        name: 'Linen Set',
        price: 20,
        stock: 5,
        launched: null,
        supplier: 'Northfield',
      }),
    ]);
    expect(d.new.map((r) => r.naturalKey)).toEqual(['NEW-1']);
    expect(d.changed).toEqual([
      { id: '1', naturalKey: 'MUG-1', fields: [{ field: 'stock', from: '10', to: '7' }] },
    ]);
    expect(d.unchanged).toBe(1);
    expect(d.missing.map((r) => r.id)).toEqual(['2', '4']);
    expect(d.conflicts).toEqual([]);
  });

  it('never blanks a value because a cell is empty in the new file', () => {
    const d = diffRecords(fields, now.slice(0, 1), [
      incoming('MUG-1', { name: 'Sage Mug', price: null, stock: 10, launched: null, supplier: '' }),
    ]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it('turns changes to fields the owner edited in the app into conflicts', () => {
    const d = diffRecords(fields, now.slice(1, 2), [
      incoming('MUG-2', {
        name: 'Oat Mug',
        price: 19.5,
        stock: 3,
        launched: null,
        supplier: 'Hearth',
      }),
    ]);
    expect(d.changed).toEqual([
      { id: '2', naturalKey: 'MUG-2', fields: [{ field: 'stock', from: '4', to: '3' }] },
    ]);
    expect(d.conflicts).toEqual([
      { id: '2', naturalKey: 'MUG-2', field: 'price', mine: '18', theirs: '19.5' },
    ]);
  });

  it('matches records without a key by their content, and flags repeated keys', () => {
    const unkeyed = [
      existing('9', null, {
        name: 'Till sale',
        price: '3.0000',
        stock: null,
        launched: null,
        supplier: null,
      }),
    ];
    unkeyed[0]!.rowHash = 'same';
    const d = diffRecords(fields, unkeyed, [
      incoming(
        null,
        { name: 'Till sale', price: 3, stock: null, launched: null, supplier: null },
        'same',
      ),
      incoming(
        null,
        { name: 'Till sale 2', price: 4, stock: null, launched: null, supplier: null },
        'other',
      ),
      incoming('A', { name: 'A', price: 1, stock: 1, launched: null, supplier: null }),
      incoming('A', { name: 'A again', price: 1, stock: 1, launched: null, supplier: null }),
    ]);
    expect(d.unchanged).toBe(1);
    expect(d.new.map((r) => r.values.name)).toEqual(['Till sale 2', 'A']);
    expect(d.new[0]!.unkeyed).toBe(true);
    expect(d.duplicates).toEqual([{ naturalKey: 'A', count: 2 }]);
    expect(d.missing).toEqual([]);
  });

  it('only calls records missing when they came from the same source', () => {
    const scoped = [{ ...now[3]!, inScope: false }];
    expect(diffRecords(fields, scoped, []).missing).toEqual([]);
  });
});

describe('mergeWrites', () => {
  it('inserts new records, updates changed fields, and resolves conflicts as chosen; never deletes', () => {
    const d = diffRecords(
      fields,
      [
        existing(
          '1',
          'A',
          { name: 'A', price: '1.0000', stock: 1, launched: null, supplier: null },
          ['price'],
        ),
        existing('2', 'B', {
          name: 'B',
          price: '2.0000',
          stock: 2,
          launched: null,
          supplier: null,
        }),
      ],
      [
        incoming('A', { name: 'A', price: 1.5, stock: 3, launched: null, supplier: null }),
        incoming('C', { name: 'C', price: 3, stock: 3, launched: null, supplier: null }),
      ],
    );
    const keepMine = mergeWrites(d, {});
    expect(keepMine.inserts.map((r) => r.naturalKey)).toEqual(['C']);
    expect(keepMine.updates).toEqual([{ id: '1', set: { stock: '3' }, before: { stock: '1' } }]);
    const takeFile = mergeWrites(d, { '1:price': 'theirs' });
    expect(takeFile.updates).toEqual([
      { id: '1', set: { stock: '3', price: '1.5' }, before: { stock: '1', price: '1' } },
    ]);
    expect(Object.keys(takeFile)).toEqual(['inserts', 'updates']);
  });
});
