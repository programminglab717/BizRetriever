import { writeFileSync } from 'node:fs';
import path from 'node:path';

import ExcelJS from 'exceljs';

import { mdy, type IsoDate } from '../dates';
import { Rng } from '../rng';
import type { SheetReport } from '../writers';
import { invoiceNet, type WholesaleSimulation } from './simulate';

/**
 * The wholesaler's files, messy the way real ones are (M14): title and export-date rows above the
 * headers, a totals row, money written as text with a dollar sign, terms as "30 days", category
 * headings inside the stock list, US dates, and invoice-level details repeated on every line.
 */

const n = (c: number) => Math.round(c) / 100;
const dollars = (c: number) =>
  `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const skipped = (): SheetReport['skipped'] => ({
  title: 0,
  blank: 0,
  totals: 0,
  notes: 0,
  section: 0,
});
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

async function writeInvoices(
  sim: WholesaleSimulation,
  dir: string,
  rng: Rng,
): Promise<SheetReport> {
  const file = 'Sales invoices.xlsx';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoices');
  const report: SheetReport = { file, sheet: 'Invoices', dataRows: 0, skipped: skipped() };
  ws.addRow(['Harbour & Pine Supply Co. — Sales invoices']).font = { bold: true, size: 14 };
  ws.addRow([`Exported ${mdy(sim.today)}`]);
  ws.addRow([]);
  report.skipped.title += 2;
  report.skipped.blank += 1;
  ws.addRow([
    'Invoice No',
    'Invoice Date',
    'Account',
    'Item Code',
    'Description',
    'Qty',
    'Backordered',
    'Unit Price',
    'Line Total',
    'Due Date',
    'Status',
  ]).font = { bold: true };
  ws.getColumn(2).numFmt = 'mm/dd/yyyy';
  ws.getColumn(10).numFmt = 'mm/dd/yyyy';
  let total = 0;
  for (const inv of sim.invoices) {
    const status = inv.paidOn ? 'Paid' : inv.due < sim.today ? 'Overdue' : 'Unpaid';
    for (const l of inv.lines) {
      ws.addRow([
        inv.number,
        date(inv.date),
        inv.customer.name,
        l.product.code,
        l.product.name,
        l.qty,
        l.backordered > 0 ? l.backordered : null,
        n(l.unitPrice),
        n(l.qty * l.unitPrice),
        date(inv.due),
        rng.chance(0.1) ? status.toUpperCase() : status,
      ]);
      report.dataRows += 1;
      total += l.qty * l.unitPrice;
    }
  }
  ws.addRow([]);
  ws.addRow(['Total', null, null, null, null, null, null, null, n(total)]).font = { bold: true };
  report.skipped.blank += 1;
  report.skipped.totals += 1;
  await wb.xlsx.writeFile(path.join(dir, file));
  return report;
}

function writeAccounts(sim: WholesaleSimulation, dir: string): SheetReport {
  const file = 'Customer accounts.csv';
  const rows: (string | number)[][] = [
    ['Acct No', 'Customer', 'Type', 'City', 'State', 'Rep', 'Terms', 'Credit Limit', 'Email'],
    ...sim.customers.map((c) => [
      c.account,
      c.name,
      c.type,
      c.city,
      'ME',
      c.rep,
      `${c.termsDays} days`,
      dollars(c.creditLimit),
      c.email,
    ]),
  ];
  writeFileSync(path.join(dir, file), csv(rows));
  return { file, sheet: file, dataRows: sim.customers.length, skipped: skipped() };
}

async function writePayments(sim: WholesaleSimulation, dir: string): Promise<SheetReport> {
  const file = 'Payments received.xlsx';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payments');
  ws.addRow(['Date', 'Customer', 'Invoice', 'Amount', 'Method', 'Ref']).font = { bold: true };
  ws.getColumn(1).numFmt = 'mm/dd/yyyy';
  for (const p of sim.payments)
    ws.addRow([
      date(p.date),
      p.invoice.customer.name,
      p.invoice.number,
      n(p.amount),
      p.method,
      p.reference,
    ]);
  await wb.xlsx.writeFile(path.join(dir, file));
  return { file, sheet: 'Payments', dataRows: sim.payments.length, skipped: skipped() };
}

async function writeStock(sim: WholesaleSimulation, dir: string): Promise<SheetReport> {
  const file = 'Warehouse stock.xlsx';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stock');
  const report: SheetReport = { file, sheet: 'Stock', dataRows: 0, skipped: skipped() };
  ws.addRow([`Stock as of ${mdy(sim.today)}`]).font = { bold: true };
  report.skipped.title += 1;
  ws.addRow(['Code', 'Product', 'Case Size', 'Cost', 'Trade Price', 'In Stock', 'Supplier']).font =
    {
      bold: true,
    };
  for (const category of [...new Set(sim.products.map((p) => p.category))]) {
    ws.addRow([category.toUpperCase()]).font = { bold: true };
    report.skipped.section += 1;
    for (const p of sim.products.filter((x) => x.category === category)) {
      ws.addRow([p.code, p.name, p.caseSize, n(p.cost), n(p.price), p.stockOnHand, p.supplier]);
      report.dataRows += 1;
    }
  }
  await wb.xlsx.writeFile(path.join(dir, file));
  return report;
}

function writePurchases(sim: WholesaleSimulation, dir: string): SheetReport {
  const file = 'Purchase orders.csv';
  const rows: (string | number)[][] = [
    ['PO Number', 'Supplier', 'Order Date', 'Received', 'Item Code', 'Product', 'Qty', 'Cost Each'],
    ...sim.purchases.map((l) => [
      l.po,
      l.supplier,
      mdy(l.ordered),
      l.received ? mdy(l.received) : '',
      l.product.code,
      l.product.name,
      l.qty,
      (l.unitCost / 100).toFixed(2),
    ]),
  ];
  writeFileSync(path.join(dir, file), csv(rows));
  return { file, sheet: file, dataRows: sim.purchases.length, skipped: skipped() };
}

export async function writeWholesaleFiles(
  sim: WholesaleSimulation,
  dir: string,
  seed: number,
): Promise<SheetReport[]> {
  const rng = new Rng(seed + 7);
  return [
    await writeInvoices(sim, dir, rng),
    writeAccounts(sim, dir),
    await writePayments(sim, dir),
    await writeStock(sim, dir),
    writePurchases(sim, dir),
  ];
}

export { invoiceNet };
