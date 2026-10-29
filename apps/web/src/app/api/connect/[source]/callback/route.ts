import {
  completeConnect,
  ConnectError,
  connectCookiePath,
  connectStateCookie,
  oauthProvider,
} from '@bizr/core/connections';
import { getEnv, getLogger } from '@bizr/platform';
import { cookies } from 'next/headers';

import { kickJobs } from '@/lib/imports';
import { getJobQueue } from '@/lib/jobs';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The provider sends the owner back here once they approve (M18). Checked in full first. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
): Promise<Response> {
  const { source } = await params;
  const provider = oauthProvider(source);
  if (!provider || !provider.enabled())
    // i18n-skip: for the provider, not a person
    return Response.json({ error: 'Not found' }, { status: 404 });
  const jar = await cookies();
  const cookie = jar.get(connectStateCookie(provider.kind))?.value;
  jar.delete({ name: connectStateCookie(provider.kind), path: connectCookiePath(provider.kind) });
  const session = await getSession();
  const appUrl = getEnv().APP_URL;
  try {
    const { slug } = await completeConnect(provider, {
      params: new URL(request.url).searchParams,
      cookie,
      sessionUserId: session?.user.id,
      queue: await getJobQueue(),
    });
    kickJobs();
    return Response.redirect(new URL(`/w/${slug}/data?connected=${provider.kind}`, appUrl), 303);
  } catch (err) {
    if (!(err instanceof ConnectError))
      getLogger('connections').error({ err, source }, 'callback failed');
    const failed = new URL('/connect/failed', appUrl);
    // Codes, not text: the page shows only its own messages.
    failed.searchParams.set('source', provider.kind);
    failed.searchParams.set(
      'why',
      err instanceof ConnectError && /wasn’t connected/.test(err.message)
        ? 'declined'
        : err instanceof ConnectError && /didn’t work/.test(err.message)
          ? 'refused'
          : 'provider',
    );
    return Response.redirect(failed, 303);
  }
}
