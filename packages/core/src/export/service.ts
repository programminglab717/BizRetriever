import { auditEvent, getAppDb } from '@bizr/db';
import { getPack } from '@bizr/packs';

import { getAnswer } from '../ask/service';
import { localeFor, type ViewOptions } from '../ask/view';
import type { AnswerData } from '../ask/answer';
import { tileData } from '../dashboard/service';
import type { DashboardRange } from '../dashboard/model';
import { allRecords, listRecordTypes } from '../records/service';
import type { MemberWorkspace } from '../workspaces/service';
import { answerSheet, fieldColumn, fileNameFor, type Sheet } from './sheet';
import { toCsv, toXlsx, type AboutLine } from './write';

/**
 * Downloads (PRODUCT_SPEC §2.1, ADR-056): an answer or a dashboard tile as CSV or Excel, and every
 * record as one Excel workbook. Each file holds exactly the values of an executed query (or the
 * records themselves); nothing is recalculated here.
 */

export type DownloadFormat = 'csv' | 'xlsx';

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
};

function viewOptions(member: MemberWorkspace): ViewOptions {
  return {
    pack: getPack(member.workspace.packId),
    locale: localeFor(member.settings),
    currency: member.settings.currency,
    fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
  };
}

/** "26 Oct 2026, 14:05" in the business's own time zone. */
function madeAt(member: MemberWorkspace, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: member.settings.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(now);
}

function rowsNote(data: AnswerData): string | undefined {
  if (data.truncated) return `Shows the first ${data.rows.length} rows.`;
  if (data.rows.length < data.totalRows)
    return `Shows ${data.rows.length} of ${data.totalRows} rows.`;
  return undefined;
}

async function encode(
  format: DownloadFormat,
  title: string,
  sheet: Sheet,
  about: AboutLine[],
): Promise<Download> {
  return {
    fileName: fileNameFor(title, format),
    contentType: CONTENT_TYPES[format],
    body: format === 'csv' ? new TextEncoder().encode(toCsv(sheet)) : await toXlsx([sheet], about),
  };
}

/** A stored answer as a file: the rows the owner saw. Null for answers without numbers. */
export async function answerDownload(
  member: MemberWorkspace,
  answerId: string,
  format: DownloadFormat,
  now = new Date(),
): Promise<Download | null> {
  const a = await getAnswer(member, answerId);
  const data = a?.content.data;
  if (!a || !data || data.columns.length === 0) return null;
  const c = a.content;
  const note = rowsNote(data);
  const about: AboutLine[] = [
    { label: 'Question', value: a.question },
    { label: 'Answer', value: c.title },
    ...(c.comparedWith ? [{ label: 'Compared with', value: c.comparedWith }] : []),
    ...c.assumptions.map((value) => ({ label: 'Assumption', value })),
    ...(note ? [{ label: 'Note', value: note }] : []),
    { label: 'Asked', value: madeAt(member, a.createdAt) },
    { label: 'Downloaded', value: madeAt(member, now) },
  ];
  const sheet = answerSheet('Answer', data, {
    ...viewOptions(member),
    comparedWith: c.comparedWith,
  });
  return encode(format, c.title, sheet, about);
}

/** A dashboard tile as a file, for the dashboard's dates. Null when the tile isn't there. */
export async function tileDownload(
  member: MemberWorkspace,
  tileId: string,
  format: DownloadFormat,
  range?: DashboardRange,
  now = new Date(),
): Promise<Download | null> {
  const t = await tileData(member, tileId, range);
  if (!t) return null;
  const rows = rowsNote(t.data);
  const about: AboutLine[] = [
    { label: 'Tile', value: t.title },
    { label: 'Dates', value: t.datesLabel },
    ...(t.comparedWith ? [{ label: 'Compared with', value: t.comparedWith }] : []),
    ...(t.note ? [{ label: 'Note', value: t.note }] : []),
    ...(rows ? [{ label: 'Note', value: rows }] : []),
    { label: 'Downloaded', value: madeAt(member, now) },
  ];
  const sheet = answerSheet(t.title, t.data, {
    ...viewOptions(member),
    comparedWith: t.comparedWith,
  });
  return encode(format, `${t.title} ${t.datesLabel}`, sheet, about);
}

/**
 * Every record type as a tab of one workbook ("Download all my data"), with the linked records by
 * name. Recorded in the business's activity log.
 */
export async function allDataDownload(
  member: MemberWorkspace,
  userId: string | null,
  now = new Date(),
): Promise<Download> {
  const types = await listRecordTypes(member);
  const sheets: Sheet[] = [];
  const about: AboutLine[] = [{ label: 'Business', value: member.workspace.name }];
  for (const t of types) {
    const { entity, rows, total } = await allRecords(member, t.key, RECORDS_PER_TYPE_MAX);
    const cols = entity.fields.map((f) => fieldColumn(f, member.settings.currency));
    sheets.push({
      name: entity.label.plural,
      columns: cols.map(({ label, type }) => ({ label, type })),
      rows: rows.map((r) => entity.fields.map((f, i) => cols[i]!.cell(r.values[f.key] ?? null))),
    });
    about.push({
      label: entity.label.plural,
      value:
        rows.length < total
          ? `The first ${rows.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} records.`
          : `${rows.length.toLocaleString('en-US')} ${rows.length === 1 ? 'record' : 'records'}.`,
    });
  }
  about.push({ label: 'Downloaded', value: madeAt(member, now) });
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
    body: await toXlsx(sheets, about),
  };
}
