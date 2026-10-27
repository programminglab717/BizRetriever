import { randomUUID } from 'node:crypto';

import { auditEvent, closePools, getAppDb } from '@bizr/db';
import { databaseAvailable } from '@bizr/platform/testing';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { askQuestion } from '../ask/service';
import { currentDashboard, ensureDefaultDashboard } from '../dashboard/service';
import { listRecordTypes } from '../records/service';
import { loadDemoWorkspace, type DemoWorkspace } from '../testing/demo-workspace';
import { pdfText } from '../testing/pdf';
import { allDataDownload, answerDownload, dashboardPdf, tileDownload } from './service';

/** Downloads (M9, ADR-056): the file holds the same values the owner saw. */
const hasDb = await databaseAvailable();
const noAi = { provider: null, aiMode: 'never' as const };

async function workbook(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  return wb;
}

describe.skipIf(!hasDb)('downloads (integration)', () => {
  let demo: DemoWorkspace;

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: '2026-10-13', name: 'Fernwood Export Test' });
  }, 240_000);
  afterAll(async () => {
    await demo?.dispose();
    await closePools();
  });

  it('downloads an answer as CSV and Excel with the exact stored values', async () => {
    const a = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'Net sales by channel last month' },
      noAi,
    );
    const data = a.content.data!;
    expect(data.rows.length).toBeGreaterThan(1);
    const money = data.columns.find((c) => c.format === 'money')!;

    const csv = await answerDownload(demo.member, a.answerId, 'csv');
    expect(csv!.contentType).toMatch(/^text\/csv/);
    expect(csv!.fileName).toMatch(/\.csv$/);
    const lines = new TextDecoder()
      .decode(csv!.body)
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(data.rows.length + 1);
    expect(lines[0]).toContain(`${money.label} (USD)`);
    // Money is written exactly as Postgres returned it.
    for (const [i, r] of data.rows.entries())
      expect(lines[i + 1]!.split(',')).toContain(String(r[money.key]));

    const xlsx = await answerDownload(demo.member, a.answerId, 'xlsx');
    const wb = await workbook(xlsx!.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Answer', 'About this file']);
    expect(wb.worksheets[0]!.rowCount).toBe(data.rows.length + 1);
    const about = wb.worksheets[1]!.getColumn(2).values.map(String);
    expect(about).toContain('Net sales by channel last month');
  }, 60_000);

  it('makes a PDF of an answer with the same numbers the owner saw (M15)', async () => {
    const a = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'Net sales by channel last month' },
      noAi,
    );
    const pdf = await answerDownload(demo.member, a.answerId, 'pdf');
    expect(pdf!.contentType).toBe('application/pdf');
    expect(pdf!.fileName).toMatch(/\.pdf$/);
    const text = pdfText(pdf!.body).join('\n');
    expect(text).toContain(a.content.title);
    // Every formatted value of the table, as the answer card shows it.
    const money = a.content.data!.columns.find((c) => c.format === 'money')!;
    for (const r of a.content.data!.rows) {
      const n = Number(r[money.key]).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      });
      expect(text).toContain(n);
    }
  }, 60_000);

  it('makes a PDF of the whole dashboard, one section per tile (M15)', async () => {
    await ensureDefaultDashboard(demo.member.workspace);
    const { tiles } = await currentDashboard(demo.member);
    const pdf = await dashboardPdf(demo.member, {
      range: { preset: 'last_90_days' },
      compare: true,
    });
    const text = pdfText(pdf.body).join('\n');
    expect(pdf.fileName).toBe('Fernwood Export Test dashboard.pdf');
    for (const t of tiles) expect(text).toContain(t.title);
    expect(text).not.toContain('Something went wrong');
  }, 60_000);

  it('gives nothing for answers without numbers or from elsewhere', async () => {
    const q = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'Who are my best customers?' },
      noAi,
    );
    expect(q.kind).toBe('clarify');
    expect(await answerDownload(demo.member, q.answerId, 'csv')).toBeNull();
    expect(await answerDownload(demo.member, randomUUID(), 'csv')).toBeNull();
    expect(await answerDownload(demo.member, 'not-an-id', 'csv')).toBeNull();
  }, 30_000);

  it('downloads a dashboard tile for the dashboard’s dates', async () => {
    await ensureDefaultDashboard(demo.member.workspace);
    const { tiles } = await currentDashboard(demo.member);
    const tile = tiles.find((t) => t.spec.dimensions.length > 0)!;
    const file = await tileDownload(demo.member, tile.id, 'xlsx', {
      range: { preset: 'last_90_days' },
      compare: false,
    });
    const wb = await workbook(file!.body);
    expect(wb.worksheets[0]!.rowCount).toBeGreaterThan(1);
    expect(wb.worksheets[1]!.getColumn(2).values.map(String)).toContain(tile.title);
    expect(await tileDownload(demo.member, randomUUID(), 'csv')).toBeNull();
  }, 60_000);

  it('downloads every record type as a tab, linked records by name, and logs it', async () => {
    const types = await listRecordTypes(demo.member);
    const file = await allDataDownload(demo.member, demo.ownerId);
    expect(file.fileName).toBe('Fernwood Export Test data.xlsx');
    const wb = await workbook(file.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      ...types.map((t) => t.label.plural),
      'About this file',
    ]);
    for (const t of types)
      expect(wb.getWorksheet(t.label.plural)!.rowCount, t.key).toBe(t.count + 1);

    const products = wb.getWorksheet(types.find((t) => t.key === 'product')!.label.plural)!;
    expect(products.rowCount).toBe(demo.sim.products.length + 1);
    // Sales show their customer by name, not by a number.
    const sales = wb.getWorksheet(types.find((t) => t.key === 'sale')!.label.plural)!;
    const header = (sales.getRow(1).values as unknown[]).map(String);
    const customerCol = header.indexOf('Customer');
    expect(customerCol).toBeGreaterThan(0);
    const named = sales
      .getColumn(customerCol)
      .values.slice(2)
      .filter((v) => typeof v === 'string');
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((v) => !/^\d+$/.test(v))).toBe(true);

    const logged = await getAppDb()
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.workspaceId, demo.member.workspace.id),
          eq(auditEvent.action, 'data.downloaded'),
        ),
      );
    expect(logged).toHaveLength(1);
  }, 120_000);
});
