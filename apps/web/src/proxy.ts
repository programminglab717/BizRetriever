import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

const SLUG_HEADER = 'x-bizr-slug';

/**
 * Fast, optimistic redirect for signed-out visitors. This only checks that a session cookie exists;
 * the real authorization (valid session + workspace membership) happens on the server in every page
 * and action (`requireWorkspace`).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  // Which business the page is in, for its default language (M20). Only ever set here.
  const headers = new Headers(request.headers);
  headers.delete(SLUG_HEADER);
  const slug = /^\/w\/([^/]+)/.exec(request.nextUrl.pathname)?.[1];
  if (slug) headers.set(SLUG_HEADER, decodeURIComponent(slug));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/onboarding/:path*', '/w/:path*'],
};
