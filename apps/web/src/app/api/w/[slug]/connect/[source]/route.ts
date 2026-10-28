import {
  beginConnect,
  ConnectError,
  connectCookiePath,
  connectStateCookie,
  oauthProvider,
} from '@bizr/core/connections';
import { canChange } from '@bizr/core/workspaces';
import { getEnv } from '@bizr/platform';
import { cookies } from 'next/headers';

import { getSession, workspaceForApi } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** "Connect QuickBooks / Xero / Square" (M18): off to the provider to approve, with a state cookie. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; source: string }> },
): Promise<Response> {
  const { slug, source } = await params;
  const provider = oauthProvider(source);
  const member = await workspaceForApi(slug);
  const session = await getSession();
  if (!provider || !provider.enabled() || !member || !session)
    return Response.json({ error: 'Not found' }, { status: 404 });
  if (!canChange(member.role))
    return Response.json(
      { error: 'You can view this business but not change it. Ask the owner.' },
      { status: 403 },
    );
  try {
    const start = beginConnect(provider, member, session.user.id);
    (await cookies()).set(connectStateCookie(provider.kind), start.cookie, {
      httpOnly: true,
      secure: getEnv().APP_URL.startsWith('https://'),
      sameSite: 'lax',
      path: connectCookiePath(provider.kind),
      maxAge: start.maxAgeSeconds,
    });
    return Response.redirect(start.url, 303);
  } catch (err) {
    if (!(err instanceof ConnectError)) throw err;
    return Response.redirect(new URL(`/w/${slug}/data/import`, getEnv().APP_URL), 303);
  }
}
