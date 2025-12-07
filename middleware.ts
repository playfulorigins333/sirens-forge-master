import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const ageVerified = req.cookies.get('ageVerified')?.value;
  const { pathname } = req.nextUrl;

  // Allow the age-check page through always
  if (pathname.startsWith('/age-check')) {
    return NextResponse.next();
  }

  // If no cookie, redirect to /age-check
  if (!ageVerified) {
    const url = req.nextUrl.clone();
    url.pathname = '/age-check';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Apply middleware to every page EXCEPT static assets
export const config = {
  matcher: ['/((?!_next|favicon.ico|api).*)'],
};
