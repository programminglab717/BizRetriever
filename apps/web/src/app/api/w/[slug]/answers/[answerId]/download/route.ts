import { answerDownload } from '@bizr/core/export';

import { fileResponse, formatParam, notFound } from '@/lib/download';
import { workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** An answer as a file: `?format=csv|xlsx`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; answerId: string }> },
): Promise<Response> {
  const { slug, answerId } = await params;
  const member = await workspaceForApi(slug);
  const format = formatParam(new URL(request.url));
  if (!member || !format) return notFound();
  const file = await answerDownload(member, answerId, format);
  return file ? fileResponse(file) : notFound();
}
