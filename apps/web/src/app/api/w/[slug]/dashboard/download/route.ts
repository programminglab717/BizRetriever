import { dashboardRangeSchema } from '@bizr/core/dashboard';
import { dashboardPdf } from '@bizr/core/export';

import { fileResponse, notFound } from '@/lib/download';
import { getLanguage } from '@/lib/i18n';
import { workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The whole dashboard as a PDF (M15): `?range=last_30_days&compare=1`, else its saved dates. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const member = await workspaceForApi(slug);
  if (!member) return notFound();
  const url = new URL(request.url);
  const preset = url.searchParams.get('range');
  const range = preset
    ? dashboardRangeSchema.safeParse({
        range: { preset },
        compare: url.searchParams.get('compare') !== '0',
      })
    : undefined;
  return fileResponse(
    await dashboardPdf(
      member,
      range?.success ? range.data : undefined,
      new Date(),
      await getLanguage(),
    ),
  );
}
