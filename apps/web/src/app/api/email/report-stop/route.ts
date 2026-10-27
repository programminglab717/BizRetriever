import { stopReport } from '@bizr/core/reports';

export const dynamic = 'force-dynamic';

const fields = (url: URL) => ({
  r: url.searchParams.get('r') ?? undefined,
  u: url.searchParams.get('u') ?? undefined,
  t: url.searchParams.get('t') ?? undefined,
});

/** Opening the link shows a page with a button, so a mail scanner's visit changes nothing. */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  return Response.redirect(new URL(`/email/report-stop${url.search}`, url), 303);
}

/** One-click stop (RFC 8058) from the List-Unsubscribe header, or the page's button. Signed link. */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ok = await stopReport(fields(url));
  if (url.searchParams.get('from') === 'page')
    return Response.redirect(new URL(`/email/report-stop?${ok ? 'done=1' : 'bad=1'}`, url), 303);
  return ok
    ? new Response('This report won’t be sent any more.', { status: 200 })
    : new Response('This link doesn’t work.', { status: 400 });
}
