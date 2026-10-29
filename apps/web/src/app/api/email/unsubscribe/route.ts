import { unsubscribe } from '@bizr/core/insights';

import { getT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const fields = (url: URL) => ({
  w: url.searchParams.get('w') ?? undefined,
  u: url.searchParams.get('u') ?? undefined,
  k: url.searchParams.get('k') ?? undefined,
  t: url.searchParams.get('t') ?? undefined,
});

/** Opening the link shows a page with a button, so a mail scanner's visit changes nothing. */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  return Response.redirect(new URL(`/email/unsubscribe${url.search}`, url), 303);
}

/**
 * One-click unsubscribe (RFC 8058): mail apps POST here straight from the List-Unsubscribe header;
 * the page's button does too. The link is signed, so no sign-in is needed.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ok = await unsubscribe(fields(url));
  const fromPage = url.searchParams.get('from') === 'page';
  if (fromPage)
    return Response.redirect(
      new URL(`/email/unsubscribe?${ok ? `done=${url.searchParams.get('k')}` : 'bad=1'}`, url),
      303,
    );
  const t = await getT();
  return ok
    ? new Response(t('You won’t get these emails any more.'), { status: 200 })
    : new Response(t('This link doesn’t work.'), { status: 400 });
}
