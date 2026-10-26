import { fileNameFor, toCsv, toXlsx } from '@bizr/core/export';
import { reorderList } from '@bizr/core/planning';

import { fileResponse, formatParam, notFound } from '@/lib/download';
import { reorderSheet } from '@/lib/reorder-sheet';
import { workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The reorder list as `?format=csv|xlsx`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const member = await workspaceForApi(slug);
  const format = formatParam(new URL(request.url));
  if (!member || !format) return notFound();
  const list = await reorderList(member);
  if (!list.available) return notFound();
  const sheet = reorderSheet(list);
  const assumed = [
    {
      label: 'What it covers',
      value: 'Each supplier’s lead time plus 30 days (14 days when no lead time is recorded).',
    },
    ...(list.seasonFactor !== 1
      ? [
          {
            label: 'Season',
            value: `Quantities allow for your usual sales over those weeks (${Math.round((list.seasonFactor - 1) * 100)}% against your last 4 weeks).`,
          },
        ]
      : []),
    { label: 'Note', value: 'Estimates from your own sales: check them against what you know.' },
  ];
  const name = `Reorder list ${new Date().toISOString().slice(0, 10)}`;
  return fileResponse({
    fileName: fileNameFor(name, format),
    contentType:
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body:
      format === 'csv' ? new TextEncoder().encode(toCsv(sheet)) : await toXlsx([sheet], assumed),
  });
}
