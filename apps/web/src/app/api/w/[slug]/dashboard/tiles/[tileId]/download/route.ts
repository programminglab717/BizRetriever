import { dashboardRangeSchema } from '@bizr/core/dashboard';
import { tileDownload } from '@bizr/core/export';

import { fileResponse, formatParam, notFound } from '@/lib/download';
import { workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** A dashboard tile as a file: `?format=csv|xlsx&range=last_30_days&compare=1`, else saved dates. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; tileId: string }> },
): Promise<Response> {
  const { slug, tileId } = await params;
  const member = await workspaceForApi(slug);
  const url = new URL(request.url);
  const format = formatParam(url);
  if (!member || !format || !/^[0-9a-f-]{36}$/i.test(tileId)) return notFound();
  const preset = url.searchParams.get('range');
  const range = preset
    ? dashboardRangeSchema.safeParse({
        range: { preset },
        compare: url.searchParams.get('compare') !== '0',
      })
    : undefined;
  const file = await tileDownload(member, tileId, format, range?.success ? range.data : undefined);
  return file ? fileResponse(file) : notFound();
}
