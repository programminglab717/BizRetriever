import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

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
  return NextResponse.next();
}

export const config = {
  matcher: ['/onboarding/:path*', '/w/:path*'],
};
