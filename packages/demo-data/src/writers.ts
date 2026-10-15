import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';

import { STORY, type Cents, type Product } from './catalog';
import { dmy, mdy, month, shortText, timeOfDay, year, type IsoDate } from './dates';
import { Rng } from './rng';
import type { Sale, Simulation } from './simulate';

/** What the writers did on purpose, so the ground truth knows what a perfect import looks like. */
export interface SheetReport {
  file: string;
  sheet: string;
  /** Rows that hold real records (after the header). */
  dataRows: number;
  skipped: { title: number; blank: number; totals: number; notes: number; section: number };
}

const money = (c: Cents) => (c / 100).toFixed(2);
const dollars = (c: Cents) => `$${money(c)}`;
const n = (c: Cents) => Math.round(c) / 100;

function utcOffset(date: IsoDate): string {
  const m = month(date);
  const d = Number(date.slice(8, 10));
  const dst = (m > 3 && m < 11) || (m === 3 && d >= 8) || (m === 11 && d < 2);
  return dst ? '-0400' : '-0500';
}

function emptySkipped(): SheetReport['skipped'] {
  return { title: 0, blank: 0, totals: 0, notes: 0, section: 0 };
}

function saleSubtotal(s: Sale): Cents {
  return s.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
}

function saleDiscount(s: Sale): Cents {
  return s.lines.reduce((t, l) => t + l.discount, 0);
}

export function saleTotal(s: Sale): Cents {
  return saleSubtotal(s) - saleDiscount(s) + s.shipping + s.tax;
}

/** How the till abbreviates some product names (they don't match the stock list exactly). */
function tillName(p: Product, rng: Rng): string {
  if (p.name === STORY.stockout && rng.chance(0.5)) return 'Sage Mug';
  if (p.name.endsWith(' Candle Small') && rng.chance(0.3))
    return p.name.replace(' Candle Small', ' Candle Sml');
  return p.name;
}

async function writeOnlineOrders(sim: Simulation, dir: string, rng: Rng): Promise<SheetReport[]> {
  const file = 'Online orders 2025-26.xlsx';
  const wb = new ExcelJS.Workbook();
  const reports: SheetReport[] = [];

  // --- Website (Shopify-style, line level, order fields only on the first line) ---
  const web = wb.addWorksheet('Website');
  const webHeaders = [
    'Name',
    'Email',
    'Financial Status',
    'Paid at',
    'Fulfillment Status',
    'Currency',
    'Subtotal',
    'Shipping',
    'Taxes',
    'Total',
    'Discount Code',
    'Discount Amount',
    'Created at',
    'Lineitem quantity',
    'Lineitem name',
    'Lineitem price',
    'Lineitem sku',
    'Billing Name',
    'Billing City',
    'Billing Province',
    'Notes',
  ];
  web.addRow(['FERNWOOD HOME & GIFT — WEBSITE ORDERS']);
  web.mergeCells(1, 1, 1, webHeaders.length);
  web.getCell(1, 1).font = { bold: true, size: 14 };
  web.addRow([`Exported ${shortText(sim.today)}`]);
  web.addRow([]);
  web.addRow(webHeaders).font = { bold: true };
  const report: SheetReport = { file, sheet: 'Website', dataRows: 0, skipped: emptySkipped() };
  report.skipped.title = 3; // title, "Exported …", blank spacer

  const webSales = sim.sales.filter((s) => s.channel === 'online_store');
  const blankAfter = new Set([rng.int(50, 400), rng.int(600, 900), rng.int(1000, 1300)]);
  let yearTotal = 0;
  let grandTotal = 0;
  webSales.forEach((sale, idx) => {
    const next = webSales[idx + 1];
    sale.lines.forEach((line, i) => {
      const first = i === 0;
      const created = `${sale.date} ${timeOfDay(sale.minutes)}:${String(rng.int(0, 59)).padStart(2, '0')} ${utcOffset(sale.date)}`;
      web.addRow([
        sale.number,
        first ? (sale.customer?.email ?? '') : '',
        first ? (sale.status === 'cancelled' ? 'voided' : 'paid') : '',
        first && sale.status !== 'cancelled' ? created : '',
        first ? (sale.status === 'cancelled' ? 'unfulfilled' : 'fulfilled') : '',
        first ? 'USD' : '',
        first ? n(saleSubtotal(sale)) : null,
        first ? n(sale.shipping) : null,
        first ? n(sale.tax) : null,
        first ? n(saleTotal(sale)) : null,
        first ? (sale.discountCode ?? '') : '',
        first ? n(saleDiscount(sale)) : null,
        first ? created : '',
        line.qty,
        line.product.name,
        n(line.unitPrice),
        line.product.sku,
        first ? (sale.customer?.name ?? '') : '',
        first ? (sale.customer?.city ?? '') : '',
        first ? (sale.customer?.region ?? '') : '',
        first ? (sale.note ?? '') : '',
      ]);
      report.dataRows += 1;
    });
    if (sale.status === 'completed') {
      yearTotal += saleTotal(sale);
      grandTotal += saleTotal(sale);
    }
    if (blankAfter.has(idx)) {
      web.addRow([]);
      report.skipped.blank += 1;
    }
    // Year-end subtotal row typed in by the owner.
    if (next && year(next.date) !== year(sale.date)) {
      web.addRow([`TOTAL ${year(sale.date)}`, '', '', '', '', '', null, null, null, n(yearTotal)]);
      report.skipped.totals += 1;
      yearTotal = 0;
    }
  });
  web.addRow([]);
  report.skipped.blank += 1;
  web.addRow(['TOTAL', '', '', '', '', '', null, null, null, n(grandTotal)]).font = { bold: true };
  report.skipped.totals += 1;
  reports.push(report);

  // --- Etsy (line level, day-first text dates, prices as "$12.00" text) ---
  const etsy = wb.addWorksheet('Etsy');
  const etsyReport: SheetReport = { file, sheet: 'Etsy', dataRows: 0, skipped: emptySkipped() };
  etsy.addRow(['Etsy sold order items']);
  etsy.getCell(1, 1).font = { bold: true, size: 13 };
  etsyReport.skipped.title = 1;
  etsy.addRow([
    'Sale Date',
    'Item Name',
    'Buyer',
    'Quantity',
    'Price',
    'Discount Amount',
    'Order Shipping',
    'Order ID',
    'SKU',
    'Ship City',
    'Ship State',
  ]).font = { bold: true };
  for (const sale of sim.sales.filter((s) => s.channel === 'etsy')) {
    sale.lines.forEach((line, i) => {
      etsy.addRow([
        dmy(sale.date),
        line.product.name,
        sale.customer?.name ?? '',
        line.qty,
        dollars(line.unitPrice),
        dollars(line.discount),
        i === 0 ? dollars(sale.shipping) : '',
        sale.number,
        rng.chance(0.3) ? '' : line.product.sku,
        sale.customer?.city ?? '',
        sale.customer?.region ?? '',
      ]);
      etsyReport.dataRows += 1;
    });
  }
  reports.push(etsyReport);

  // --- Returns log (hand-kept) ---
  const ret = wb.addWorksheet('Returns log');
  const retReport: SheetReport = {
    file,
    sheet: 'Returns log',
    dataRows: 0,
    skipped: emptySkipped(),
  };
  ret.addRow(['Date', 'Order', 'Item', 'Qty', 'Refund', 'Reason']).font = { bold: true };
  for (const r of sim.returns.filter((x) => !x.viaTill)) {
    ret.addRow([
      mdy(r.date),
      r.sale.number,
      r.product.name,
      r.qty,
      dollars(r.refund * r.qty),
      r.reason,
    ]);
    retReport.dataRows += 1;
  }
  reports.push(retReport);

  await wb.xlsx.writeFile(path.join(dir, file));
  return reports;
}

function writeTill(sim: Simulation, dir: string, rng: Rng): SheetReport {
  const file = 'Shop till export.csv';
  const report: SheetReport = { file, sheet: file, dataRows: 0, skipped: emptySkipped() };
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const rows = ['Date,Time,Receipt No,Item,Qty,Gross,Discount,Net,Payment Method,Customer'];
  type TillRow = { date: IsoDate; minutes: number; cells: string[] };
  const out: TillRow[] = [];
  for (const sale of sim.sales.filter((s) => s.channel === 'in_store')) {
    const method = rng.chance(0.8) ? 'Card' : 'Cash';
    for (const line of sale.lines) {
      const gross = line.qty * line.unitPrice;
      out.push({
        date: sale.date,
        minutes: sale.minutes,
        cells: [
          sale.date,
          timeOfDay(sale.minutes),
          sale.number,
          tillName(line.product, rng),
          String(line.qty),
          money(gross),
          money(line.discount),
          money(gross - line.discount),
          method,
          sale.customer?.name ?? '',
        ],
      });
    }
  }
  // Refunds at the till are negative-quantity lines.
  let refundNo = 90_001;
  for (const r of sim.returns.filter((x) => x.viaTill)) {
    const minutes = rng.int(10 * 60, 17 * 60);
    out.push({
      date: r.date,
      minutes,
      cells: [
        r.date,
        timeOfDay(minutes),
        `RF${refundNo++}`,
        tillName(r.product, rng),
        String(-r.qty),
        money(-r.refund * r.qty),
        '0.00',
        money(-r.refund * r.qty),
        'Card',
        '',
      ],
    });
  }
  out.sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1));
  for (const r of out) {
    rows.push(r.cells.map(quote).join(','));
    report.dataRows += 1;
  }
  // Old till software: Windows-1252, CRLF line endings.
  writeFileSync(path.join(dir, file), iconv.encode(rows.join('\r\n') + '\r\n', 'win1252'));
  return report;
}

async function writeWholesale(sim: Simulation, dir: string, rng: Rng): Promise<SheetReport[]> {
  const file = 'Wholesale invoices.xlsx';
  const wb = new ExcelJS.Workbook();
  const reports = new Map<string, SheetReport>();
  const sheetFor = (date: IsoDate) => `Q${Math.ceil(month(date) / 3)} ${year(date)}`;
  const paidLabel = (s: Sale) =>
    s.payment === 'paid' ? rng.pick(['Y', 'Y', '✓']) : s.payment === 'partial' ? 'part' : 'N';

  for (const sale of sim.sales.filter((s) => s.channel === 'wholesale')) {
    const name = sheetFor(sale.date);
    let ws = wb.getWorksheet(name);
    if (!ws) {
      ws = wb.addWorksheet(name);
      ws.addRow([
        'Invoice No',
        'Date',
        'Customer',
        'Item',
        'Qty',
        'Unit Price',
        'Line Total',
        'Due Date',
        'Paid?',
      ]).font = { bold: true };
      ws.getColumn(2).numFmt = 'mm/dd/yyyy';
      ws.getColumn(8).numFmt = 'mm/dd/yyyy';
      reports.set(name, { file, sheet: name, dataRows: 0, skipped: emptySkipped() });
    }
    const due = rng.chance(0.2) ? null : sale.dueDate;
    const paid = paidLabel(sale);
    for (const line of sale.lines) {
      ws.addRow([
        sale.number,
        new Date(`${sale.date}T00:00:00Z`),
        sale.stockistSpelling,
        line.product.name,
        rng.chance(0.6) ? `${line.qty} pcs` : line.qty,
        n(line.unitPrice),
        n(line.qty * line.unitPrice),
        due ? new Date(`${due}T00:00:00Z`) : null,
        paid,
      ]);
      reports.get(name)!.dataRows += 1;
    }
  }
  await wb.xlsx.writeFile(path.join(dir, file));
  return [...reports.values()];
}

async function writeStockList(sim: Simulation, dir: string, rng: Rng): Promise<SheetReport> {
  const file = 'Stock list & costs.xlsx';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stock list');
  const report: SheetReport = { file, sheet: 'Stock list', dataRows: 0, skipped: emptySkipped() };
  // Two header rows: "Price" over Cost/RRP and "Stock" over in-stock/reorder.
  ws.addRow(['', '', '', 'Price', '', 'Stock', '', '']);
  ws.mergeCells('D1:E1');
  ws.mergeCells('F1:G1');
  ws.addRow([
    'SKU',
    'Product',
    'Supplier',
    'Cost (ex tax)',
    'RRP',
    'Pcs in stock',
    'Reorder at',
    'Notes',
  ]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).font = { bold: true };

  const categories = [...new Set(sim.products.map((p) => p.category))];
  for (const category of categories) {
    ws.addRow([category.toUpperCase()]).font = { bold: true };
    report.skipped.section += 1;
    for (const p of sim.products.filter((x) => x.category === category)) {
      const stock = sim.stockOnHand.get(p) ?? 0;
      ws.addRow([
        p.skuListed ? p.sku : '',
        p.name,
        p.supplier,
        rng.chance(0.3) ? dollars(p.cost) : n(p.cost),
        n(p.price),
        rng.chance(0.4) ? `${stock} pcs` : stock,
        p.reorderAt,
        p.discontinued ? 'no longer stocked' : '',
      ]);
      report.dataRows += 1;
      if (p.discontinued) {
        ws.addRow(['DISCONTINUED - do not reorder']);
        report.skipped.notes += 1;
      }
    }
  }
  ws.addRow([]);
  report.skipped.blank += 1;
  const lastData = ws.rowCount - 1;
  const totalStock = sim.products.reduce((t, p) => t + (sim.stockOnHand.get(p) ?? 0), 0);
  // A SUM formula with a cached result (some cells say "45 pcs", so the owner's total is wrong-ish).
  ws.addRow([
    'TOTAL',
    '',
    '',
    '',
    '',
    { formula: `SUM(F3:F${lastData})`, result: totalStock },
  ]).font = { bold: true };
  report.skipped.totals += 1;
  await wb.xlsx.writeFile(path.join(dir, file));
  return report;
}

function writeSupplierOrders(sim: Simulation, dir: string, rng: Rng): SheetReport {
  const file = 'Supplier orders.csv';
  const report: SheetReport = { file, sheet: file, dataRows: 0, skipped: emptySkipped() };
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const rows = ['PO Number,Supplier,Order Date,Received,SKU,Item,Qty,Unit Cost,Line Total'];
  const fmt = (d: IsoDate) => (rng.chance(0.5) ? d : shortText(d));
  for (const po of sim.purchases) {
    const supplier = rng.chance(0.3) ? `${po.supplier}  ` : po.supplier;
    for (const line of po.lines) {
      rows.push(
        [
          po.po,
          supplier,
          fmt(po.orderDate),
          po.receivedDate ? fmt(po.receivedDate) : '',
          line.product.sku,
          line.product.name,
          String(line.qty),
          money(line.unitCost),
          money(line.qty * line.unitCost),
        ]
          .map(quote)
          .join(','),
      );
      report.dataRows += 1;
    }
  }
  writeFileSync(path.join(dir, file), rows.join('\n') + '\n', 'utf8');
  return report;
}

async function writeExpenses(sim: Simulation, dir: string): Promise<SheetReport> {
  const file = `Expenses ${sim.expenseYear}.xlsx`;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(sim.expenseYear));
  const report: SheetReport = {
    file,
    sheet: String(sim.expenseYear),
    dataRows: 0,
    skipped: emptySkipped(),
  };
  const months = [...sim.expenses[0]!.byMonth.keys()];
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  ws.addRow([`Expenses ${sim.expenseYear}`]);
  ws.mergeCells(1, 1, 1, months.length + 2);
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  report.skipped.title = 1;
  ws.addRow(['Category', ...months.map((m) => monthNames[m - 1]!), 'TOTAL']).font = { bold: true };
  const monthTotals = months.map(() => 0);
  for (const row of sim.expenses) {
    let rowTotal = 0;
    ws.addRow([
      row.category,
      ...months.map((m, i) => {
        const v = row.byMonth.get(m) ?? 0;
        rowTotal += v;
        monthTotals[i]! += v;
        return v === 0 ? '–' : n(v);
      }),
      n(rowTotal),
    ]);
    report.dataRows += 1;
  }
  ws.addRow(['TOTAL', ...monthTotals.map(n), n(monthTotals.reduce((a, b) => a + b, 0))]).font = {
    bold: true,
  };
  report.skipped.totals += 1;
  await wb.xlsx.writeFile(path.join(dir, file));
  return report;
}

export async function writeFiles(
  sim: Simulation,
  dir: string,
  seed: number,
): Promise<SheetReport[]> {
  mkdirSync(dir, { recursive: true });
  // A separate RNG for presentation noise, so changing the files never changes the business data.
  const rng = new Rng(seed ^ 0x5eed);
  return [
    ...(await writeOnlineOrders(sim, dir, rng)),
    writeTill(sim, dir, rng),
    ...(await writeWholesale(sim, dir, rng)),
    await writeStockList(sim, dir, rng),
    writeSupplierOrders(sim, dir, rng),
    await writeExpenses(sim, dir),
  ];
}
