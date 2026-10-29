import { IngestionRequestError, startIngestion, UPLOAD_LIMITS } from '@bizr/core/ingestion';
import { getLogger, withLogContext } from '@bizr/platform';
import { canChange } from '@bizr/core/workspaces';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';
import { getT } from '@/lib/i18n';
import { getSession, workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Upload files and start an import. Multipart form with one or more `files`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const t = await getT();
  const member = await workspaceForApi(slug);
  const session = await getSession();
  if (!member || !session) return Response.json({ error: t('Not found') }, { status: 404 });
  if (!canChange(member.role))
    return Response.json(
      { error: t('You can view this business but not change it. Ask the owner.') },
      { status: 403 },
    );

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > UPLOAD_LIMITS.maxFiles * UPLOAD_LIMITS.maxFileBytes + 1_000_000) {
    return Response.json(
      { error: t('These files are too large to upload at once.') },
      { status: 413 },
    );
  }

  return withLogContext({ workspaceId: member.workspace.id }, async () => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json(
        { error: t('We couldn’t receive those files. Please try again.') },
        { status: 400 },
      );
    }
    const files = await Promise.all(
      form
        .getAll('files')
        .filter((f): f is File => typeof f !== 'string')
        .map(async (f) => ({
          fileName: f.name,
          mime: f.type || undefined,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
    );
    try {
      const { runId } = await startIngestion({
        member,
        userId: session.user.id,
        files,
        queue: await getJobQueue(),
      });
      kickJobs();
      return Response.json({ runId }, { status: 201 });
    } catch (err) {
      if (err instanceof IngestionRequestError)
        return Response.json({ error: t.text(err.message) }, { status: 400 });
      getLogger('imports').error({ err }, 'upload failed');
      return Response.json(
        {
          error: t(
            'Something went wrong while uploading. Your files weren’t changed. Please try again.',
          ),
        },
        { status: 500 },
      );
    }
  });
}
