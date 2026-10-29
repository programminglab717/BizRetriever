import { allDataDownload } from '@bizr/core/export';
import { withLogContext } from '@bizr/platform';

import { fileResponse, notFound } from '@/lib/download';
import { getLanguage } from '@/lib/i18n';
import { getSession, workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every record, one tab per kind, as an Excel workbook. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const member = await workspaceForApi(slug);
  const session = await getSession();
  if (!member || !session) return notFound();
  return withLogContext({ workspaceId: member.workspace.id }, async () =>
    fileResponse(await allDataDownload(member, session.user.id, new Date(), await getLanguage())),
  );
}
