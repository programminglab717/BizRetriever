import { auditEvent, getAppDb } from '@bizr/db';
import { translator, type Language, type Translator } from '@bizr/i18n';
import { getPack } from '@bizr/packs';

import { getAnswer } from '../ask/service';
import { answerView, localeFor, tableView, type ViewOptions } from '../ask/view';
import type { AnswerData } from '../ask/answer';
import { dashboardView, tileData } from '../dashboard/service';
import type { DashboardRange } from '../dashboard/model';
import { allRecords, listRecordTypes } from '../records/service';
import type { MemberWorkspace } from '../workspaces/service';
import { answerSheet, fieldColumn, fileNameFor, type Sheet } from './sheet';
import { toPdf, type PdfBlock } from './pdf';
import { toCsv, toXlsx, type AboutLine } from './write';

/**
 * Downloads (PRODUCT_SPEC §2.1, ADR-056): an answer or a dashboard tile as CSV or Excel, and every
 * record as one Excel workbook. Each file holds exactly the values of an executed query (or the
 * records themselves); nothing is recalculated here.
 */

export type DownloadFormat = 'csv' | 'xlsx' | 'pdf';

export interface Download {
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

/** Records per type in "Download all my data". Excel holds about a million rows per tab. */
export const RECORDS_PER_TYPE_MAX = 100_000;

const CONTENT_TYPES: Record<DownloadFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const words = (segments: readonly { text: string }[] | undefined) =>
  segments?.map((s) => s.text).join('') ?? '';

function viewOptions(member: MemberWorkspace, lang: Language = 'en'): ViewOptions {
  return {
    pack: getPack(member.workspace.packId),
    locale: localeFor(member.settings, lang),
    currency: member.settings.currency,
    fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
  };
}

/** "26 Oct 2026, 14:05" in the business's own time zone. */
function madeAt(member: MemberWorkspace, now: Date, lang: Language = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', {
    timeZone: member.settings.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(now);
}

function rowsNote(data: AnswerData, t: Translator): string | undefined {
  if (data.truncated) return t('Shows the first {n} rows.', { n: data.rows.length });
  if (data.rows.length < data.totalRows)
    return t('Shows {n} of {total} rows.', { n: data.rows.length, total: data.totalRows });
  return undefined;
}

/** Column names in the reader's language (M20). */
const localColumns = (data: AnswerData, t: Translator): AnswerData =>
  t.lang === 'en'
    ? data
    : { ...data, columns: data.columns.map((c) => ({ ...c, label: t.text(c.label) })) };

async function encode(
  format: 'csv' | 'xlsx',
  title: string,
  sheet: Sheet,
  about: AboutLine[],
  t: Translator,
): Promise<Download> {
  return {
    fileName: fileNameFor(title, format),
    contentType: CONTENT_TYPES[format],
    body:
      format === 'csv'
        ? new TextEncoder().encode(toCsv(sheet))
        : await toXlsx([sheet], about, t('About this file')),
  };
}

async function pdfFile(
  title: string,
  subtitle: string,
  blocks: PdfBlock[],
  about: AboutLine[],
  t: Translator,
): Promise<Download> {
  return {
    fileName: fileNameFor(title, 'pdf'),
    contentType: CONTENT_TYPES.pdf,
    body: await toPdf({ title, subtitle, blocks, about, lang: t.lang }),
  };
}

/** A stored answer as a file: the rows the owner saw. Null for answers without numbers. */
export async function answerDownload(
  member: MemberWorkspace,
  answerId: string,
  format: DownloadFormat,
  now = new Date(),
  lang: Language = 'en',
): Promise<Download | null> {
  const t = translator(lang);
  const stored = await getAnswer(member, answerId);
  if (!stored?.content.data || stored.content.data.columns.length === 0) return null;
  // Answers are kept in the language they were asked in; what the file adds is in the reader's.
  const a = {
    ...stored,
    content: { ...stored.content, data: localColumns(stored.content.data, t) },
  };
  const data = a.content.data;
  const c = a.content;
  const note = rowsNote(data, t);
  const L = {
    question: t('Question'),
    answer: t('Answer'),
    compared: t('Compared with'),
    assumption: t('Assumption'),
    note: t('Note'),
  };
  const about: AboutLine[] = [
    { label: L.question, value: a.question },
    { label: L.answer, value: t.text(c.title) },
    ...(c.comparedWith ? [{ label: L.compared, value: c.comparedWith }] : []),
    ...c.assumptions.map((value) => ({ label: L.assumption, value: t.text(value) })),
    ...(note ? [{ label: L.note, value: note }] : []),
    { label: t('Asked'), value: madeAt(member, a.createdAt, lang) },
    { label: t('Downloaded'), value: madeAt(member, now, lang) },
  ];
  if (format === 'pdf') {
    const v = answerView(a, viewOptions(member, lang));
    return pdfFile(
      t.text(c.title),
      `${member.workspace.name} · “${a.question}”`,
      [
        {
          paragraphs: [t.text(words(v.headline))].filter(Boolean),
          ...(v.chart === 'kpi' && v.kpis?.length ? { kpis: v.kpis } : {}),
          ...(v.chart ? { chart: v.chart } : {}),
          ...(v.table ? { table: v.table } : {}),
          ...(v.steps?.length ? { steps: v.steps.map((x) => t.text(x)) } : {}),
          ...(v.assumptions.length ? { notes: v.assumptions.map((x) => t.text(x)) } : {}),
        },
      ],
      about.filter((l) => l.label !== L.assumption && l.label !== L.answer),
      t,
    );
  }
  const sheet = answerSheet(t('Answer'), data, {
    ...viewOptions(member, lang),
    comparedWith: c.comparedWith,
  });
  return encode(format, t.text(c.title), sheet, about, t);
}

/** A dashboard tile as a file, for the dashboard's dates. Null when the tile isn't there. */
export async function tileDownload(
  member: MemberWorkspace,
  tileId: string,
  format: DownloadFormat,
  range?: DashboardRange,
  now = new Date(),
  lang: Language = 'en',
): Promise<Download | null> {
  const tr = translator(lang);
  const t = await tileData(member, tileId, range, lang);
  if (!t) return null;
  const rows = rowsNote(t.data, tr);
  const note = t.note ? tr.text(t.note) : undefined;
  const tileLabel = tr('Tile');
  const about: AboutLine[] = [
    { label: tileLabel, value: t.title },
    { label: tr('Dates'), value: t.datesLabel },
    ...(t.comparedWith ? [{ label: tr('Compared with'), value: t.comparedWith }] : []),
    ...(note ? [{ label: tr('Note'), value: note }] : []),
    ...(rows ? [{ label: tr('Note'), value: rows }] : []),
    { label: tr('Downloaded'), value: madeAt(member, now, lang) },
  ];
  if (format === 'pdf') {
    const table = tableView(t.data, viewOptions(member, lang));
    return pdfFile(
      `${t.title} ${t.datesLabel}`,
      `${member.workspace.name} · ${t.datesLabel}`,
      [{ chart: t.chart, table, ...(note ? { notes: [note] } : {}) }],
      about.filter((l) => l.label !== tileLabel),
      tr,
    );
  }
  const sheet = answerSheet(t.title, t.data, {
    ...viewOptions(member, lang),
    comparedWith: t.comparedWith,
  });
  return encode(format, `${t.title} ${t.datesLabel}`, sheet, about, tr);
}

/**
 * The whole dashboard as one PDF (M15): every tile as the dashboard shows it for its dates, the
 * key numbers as figures, the others as a chart and table. Tiles that can't be worked out say so.
 */
export async function dashboardPdf(
  member: MemberWorkspace,
  range?: DashboardRange,
  now = new Date(),
  lang: Language = 'en',
): Promise<Download> {
  const tr = translator(lang);
  const view = await dashboardView(member, range, lang);
  const blocks: PdfBlock[] = view.tiles.map((t) => {
    const title = tr.text(t.title);
    return {
      heading: t.datesLabel ? `${title} (${t.datesLabel})` : title,
      ...(t.error
        ? { paragraphs: [t.error] }
        : t.kpis?.length && t.chart === 'kpi'
          ? { kpis: t.kpis.map((k) => ({ ...k, label: tr.text(k.label) })) }
          : { chart: t.chart, ...(t.table ? { table: t.table } : {}) }),
      ...(t.note ? { notes: [tr.text(t.note)] } : {}),
    };
  });
  const dates = view.rangeLabel;
  return pdfFile(
    tr('{business} dashboard', { business: member.workspace.name }),
    view.comparedWith
      ? tr('{range}, compared with {other}', { range: dates, other: view.comparedWith })
      : dates,
    blocks,
    [{ label: tr('Made'), value: madeAt(member, now, lang) }],
    tr,
  );
}

/**
 * Every record type as a tab of one workbook ("Download all my data"), with the linked records by
 * name. Recorded in the business's activity log.
 */
export async function allDataDownload(
  member: MemberWorkspace,
  userId: string | null,
  now = new Date(),
  lang: Language = 'en',
): Promise<Download> {
  const tr = translator(lang);
  const types = await listRecordTypes(member);
  const sheets: Sheet[] = [];
  const about: AboutLine[] = [{ label: tr('Business'), value: member.workspace.name }];
  const yesNo: [string, string] = [tr('Yes'), tr('No')];
  for (const t of types) {
    const { entity, rows, total } = await allRecords(member, t.key, RECORDS_PER_TYPE_MAX);
    const cols = entity.fields.map((f) =>
      fieldColumn({ ...f, label: tr.text(f.label) }, member.settings.currency, yesNo),
    );
    sheets.push({
      name: tr.text(entity.label.plural),
      columns: cols.map(({ label, type }) => ({ label, type })),
      rows: rows.map((r) => entity.fields.map((f, i) => cols[i]!.cell(r.values[f.key] ?? null))),
    });
    about.push({
      label: tr.text(entity.label.plural),
      value:
        rows.length < total
          ? tr('The first {n} of {total} records.', { n: rows.length, total })
          : tr.plural(rows.length, '1 record.', '{n} records.'),
    });
  }
  about.push({ label: tr('Downloaded'), value: madeAt(member, now, lang) });
  await getAppDb()
    .insert(auditEvent)
    .values({
      workspaceId: member.workspace.id,
      userId,
      action: 'data.downloaded',
      details: { types: types.map((t) => t.key) },
    });
  return {
    fileName: fileNameFor(`${member.workspace.name} data`, 'xlsx'),
    contentType: CONTENT_TYPES.xlsx,
    body: await toXlsx(sheets, about, tr('About this file')),
  };
}
