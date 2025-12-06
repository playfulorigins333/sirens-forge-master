import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const ageVerified = req.cookies.get('ageVerified');

  const pathname = req.nextUrl.pathname;

  // Allow age-check to always load
  if (pathname.startsWith('/age-check')) {
    return NextResponse.next();
  }

  // Block everything else until verified
  if (!ageVerified) {
    const url = req.nextUrl.clone();
    url.pathname = '/age-check';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|api).*)'],
};
