import { translator, type Language, type Translator } from '@bizr/i18n';
import PDFDocument from 'pdfkit';

import type { ChartType } from '../ask/interpretation';
import type { KpiView, TableView } from '../ask/view';
import type { AboutLine } from './write';

/**
 * PDF reports (M15, ADR-065): an answer, a tile or the whole dashboard laid out for printing or
 * sending. Every value arrives already formatted by the views the app shows (`TableView`,
 * `KpiView`); this file only lays them out and draws simple charts from their plotting numbers.
 * Nothing is recalculated. Uses PDFKit's built-in Helvetica, so no font files are needed.
 */

export interface PdfBlock {
  heading?: string;
  /** Sentences, such as the answer's headline. */
  paragraphs?: string[];
  kpis?: KpiView[];
  chart?: ChartType;
  table?: TableView;
  /** "How I worked it out", in order. */
  steps?: string[];
  /** Smaller print under the block: assumptions, notes. */
  notes?: string[];
}

export interface PdfReport {
  title: string;
  /** Business, dates. */
  subtitle: string;
  blocks: PdfBlock[];
  about: AboutLine[];
  /** The words the layout adds ("How it was worked out"), M20. */
  lang?: Language;
}

const MARGIN = 48;
const INK = '#1f2328';
const MUTED = '#59636e';
const RULE = '#d1d9e0';
const BAR = '#3b6fd4';
const MAX_TABLE_ROWS = 500;

/**
 * Helvetica covers Western European letters (é, ü, ñ) and common punctuation; anything else is
 * written the nearest plain way so it never prints as nonsense.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2192\u21d2]/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/[\u2713\u2714]/g, 'yes')
    .replace(/\u2212/g, '-')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[\t\n]/g, ' ')
    .replace(/[^ -~\u00a1-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, '?');
}

type Doc = PDFKit.PDFDocument;

function bottom(doc: Doc) {
  return doc.page.height - MARGIN - 18;
}

function ensure(doc: Doc, height: number) {
  if (doc.y + height > bottom(doc)) doc.addPage();
}

function width(doc: Doc) {
  return doc.page.width - MARGIN * 2;
}

function fit(doc: Doc, text: string, max: number): string {
  if (doc.widthOfString(text) <= max) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > max) t = t.slice(0, -1);
  return `${t}…`;
}

function kpiRow(doc: Doc, kpis: readonly KpiView[]) {
  const per = Math.min(4, kpis.length);
  const w = width(doc) / per;
  for (let i = 0; i < kpis.length; i += per) {
    ensure(doc, 62);
    const top = doc.y;
    kpis.slice(i, i + per).forEach((k, j) => {
      const x = MARGIN + j * w;
      doc
        .fontSize(9)
        .fillColor(MUTED)
        .text(pdfSafe(fit(doc, k.label, w - 12)), x, top, {
          width: w - 12,
          lineBreak: false,
        });
      doc
        .fontSize(18)
        .fillColor(INK)
        .text(pdfSafe(fit(doc, k.text, w - 12)), x, top + 13, { width: w - 12, lineBreak: false });
      if (k.change)
        doc
          .fontSize(9)
          .fillColor(k.change.good === false ? '#b42318' : k.change.good ? '#1a7f37' : MUTED)
          .text(pdfSafe(fit(doc, k.change.text, w - 12)), x, top + 36, {
            width: w - 12,
            lineBreak: false,
          });
    });
    doc.x = MARGIN;
    doc.y = top + 56;
  }
}

/** A bar or line chart of the first measure, when the table has one breakdown and few rows. */
function chartFor(doc: Doc, chart: ChartType | undefined, table: TableView, t: Translator) {
  if (!chart || chart === 'table' || chart === 'kpi') return;
  const metric = table.columns.findIndex((c) => c.kind === 'metric');
  const rows = table.rows.filter((r) => r.cells[metric]?.value !== null).slice(0, 40);
  if (metric < 0 || rows.length < 2) return;
  const values = rows.map((r) => r.cells[metric]!.value!);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const h = 150;
  ensure(doc, h + 34);
  const left = MARGIN;
  const top = doc.y + 4;
  const w = width(doc);
  const base = top + h * (max / span);
  doc.save();
  doc
    .lineWidth(0.5)
    .strokeColor(RULE)
    .moveTo(left, base)
    .lineTo(left + w, base)
    .stroke();
  const step = w / rows.length;
  const line = chart === 'line';
  if (line) {
    doc.lineWidth(1.5).strokeColor(BAR);
    values.forEach((v, i) => {
      const x = left + step * (i + 0.5);
      const y = top + h * ((max - v) / span);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.stroke();
  } else {
    doc.fillColor(BAR);
    values.forEach((v, i) => {
      const y = top + h * ((max - Math.max(v, 0)) / span);
      const bh = (h * Math.abs(v)) / span;
      doc
        .rect(left + step * i + step * 0.15, v >= 0 ? y : base, step * 0.7, Math.max(0.5, bh))
        .fill();
    });
  }
  // A few labels under the axis, so they never overlap.
  doc.fontSize(7).fillColor(MUTED);
  const every = Math.ceil(rows.length / 8);
  rows.forEach((r, i) => {
    if (i % every) return;
    doc.text(pdfSafe(fit(doc, r.label, step * every - 4)), left + step * i, top + h + 4, {
      width: step * every - 4,
      lineBreak: false,
    });
  });
  doc
    .fontSize(7)
    .text(
      pdfSafe(
        t('Highest: {value}', { value: rows[values.indexOf(max)]?.cells[metric]?.text ?? '' }),
      ),
      left,
      top - 2,
      {
        width: w,
        align: 'right',
        lineBreak: false,
      },
    );
  doc.restore();
  doc.x = MARGIN;
  doc.y = top + h + 20;
}

function tableOf(doc: Doc, table: TableView, t: Translator) {
  const cols = table.columns;
  if (cols.length === 0) return;
  const w = width(doc);
  const dims = cols.filter((c) => c.kind === 'dimension').length;
  const first = dims > 0 ? Math.min(w * 0.45, w / cols.length + 60) : w / cols.length;
  const rest = cols.length > 1 ? (w - first) / (cols.length - 1) : 0;
  const widths = cols.map((_, i) => (i === 0 ? first : rest));
  const rowH = 15;
  const header = () => {
    ensure(doc, rowH * 2);
    const y = doc.y;
    doc.fontSize(8).fillColor(MUTED);
    let x = MARGIN;
    cols.forEach((c, i) => {
      doc.text(pdfSafe(fit(doc, c.label, widths[i]! - 6)), x, y, {
        width: widths[i]! - 6,
        align: c.kind === 'metric' ? 'right' : 'left',
        lineBreak: false,
      });
      x += widths[i]!;
    });
    doc
      .lineWidth(0.5)
      .strokeColor(RULE)
      .moveTo(MARGIN, y + 11)
      .lineTo(MARGIN + w, y + 11)
      .stroke();
    doc.y = y + rowH;
  };
  header();
  const rows = table.rows.slice(0, MAX_TABLE_ROWS);
  for (const r of rows) {
    if (doc.y + rowH > bottom(doc)) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    doc.fontSize(9).fillColor(INK);
    let x = MARGIN;
    cols.forEach((c, i) => {
      doc.text(pdfSafe(fit(doc, r.cells[i]?.text ?? '', widths[i]! - 6)), x, y, {
        width: widths[i]! - 6,
        align: c.kind === 'metric' ? 'right' : 'left',
        lineBreak: false,
      });
      x += widths[i]!;
    });
    doc.y = y + rowH;
  }
  doc.x = MARGIN;
  const shown = rows.length;
  if (shown < table.totalRows)
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        t('Shows {shown} of {total} rows. The Excel download has more.', {
          shown,
          total: table.totalRows,
        }),
        MARGIN,
      );
  doc.moveDown(0.5);
}

function list(doc: Doc, heading: string, items: readonly string[], numbered: boolean) {
  ensure(doc, 30);
  doc
    .fontSize(9)
    .fillColor(INK)
    .text(heading, MARGIN, doc.y, { width: width(doc) });
  doc.fontSize(9).fillColor(MUTED);
  items.forEach((t, i) =>
    doc.text(pdfSafe(`${numbered ? `${i + 1}.` : '•'} ${t}`), MARGIN + 8, doc.y, {
      width: width(doc) - 8,
    }),
  );
  doc.moveDown(0.6);
}

/** Lays the report out; `compress: false` keeps the text readable in the file (for tests). */
export async function toPdf(
  report: PdfReport,
  options: { compress?: boolean; now?: Date } = {},
): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: { Title: pdfSafe(report.title), Producer: 'BizRetriever', Creator: 'BizRetriever' },
  });
  const t = translator(report.lang ?? 'en');
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  doc
    .fontSize(18)
    .fillColor(INK)
    .text(pdfSafe(report.title), { width: width(doc) });
  doc
    .fontSize(10)
    .fillColor(MUTED)
    .text(pdfSafe(report.subtitle), { width: width(doc) });
  doc.moveDown(1);

  for (const b of report.blocks) {
    if (b.heading) {
      ensure(doc, 48);
      doc
        .fontSize(12)
        .fillColor(INK)
        .text(pdfSafe(b.heading), MARGIN, doc.y, { width: width(doc) });
      doc.moveDown(0.3);
    }
    for (const p of b.paragraphs ?? [])
      doc
        .fontSize(11)
        .fillColor(INK)
        .text(pdfSafe(p), MARGIN, doc.y, { width: width(doc) })
        .moveDown(0.4);
    if (b.kpis?.length) kpiRow(doc, b.kpis);
    if (b.table) {
      chartFor(doc, b.chart, b.table, t);
      if (!b.kpis?.length || b.table.rows.length > 1) tableOf(doc, b.table, t);
    }
    if (b.steps?.length) list(doc, t('How it was worked out'), b.steps, true);
    if (b.notes?.length) list(doc, t('Good to know'), b.notes, false);
    doc.moveDown(0.6);
  }

  if (report.about.length) {
    ensure(doc, 40);
    doc
      .lineWidth(0.5)
      .strokeColor(RULE)
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + width(doc), doc.y)
      .stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor(MUTED);
    for (const a of report.about)
      doc.text(pdfSafe(`${a.label}: ${a.value}`), MARGIN, doc.y, { width: width(doc) });
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing in the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${pdfSafe(report.title)}  ·  Page ${i + 1} of ${range.count}  ·  BizRetriever`,
        MARGIN,
        doc.page.height - MARGIN + 8,
        { width: width(doc), align: 'center', lineBreak: false },
      );
  }
  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
