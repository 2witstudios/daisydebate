import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { systemId } from '@daisy/clock';
import { isValidTraceparent } from '@daisy/observability';
import { isGuardedPath, returnDestination } from './features/access/decision';
// A nonce never authorizes a `style="…"` attribute, and `next/image` always
// server-renders one. Hash the exact strings it emits (`fill`, and the default)
// so every other inline style attribute stays refused. The CSP e2e fails if a
// Next upgrade changes them. CSP mandates SHA-2 here; nothing secret is hashed.
const styleAttributeSources = [
  'position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent',
  'color:transparent',
]
  .map(
    (style) =>
      `'sha256-${createHash('sha256').update(style).digest('base64')}'`,
  )
  .join(' ');
/** Better Auth's session cookie, plain on HTTP and `__Secure-` on HTTPS. */
const SESSION_COOKIES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

export function proxy(request: NextRequest) {
  const requestId = systemId.next();
  const { pathname } = request.nextUrl;
  // Development-only architectural proof: refuse at the edge with a real 404
  // before routing when the deployment did not enable it.
  if (
    (pathname === '/foundation' || pathname.startsWith('/foundation/')) &&
    process.env.FOUNDATION_PROOF_ENABLED !== 'true'
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'x-request-id': requestId },
    });
  }
  const nonce = Buffer.from(systemId.next()).toString('base64');
  const development = process.env.NODE_ENV === 'development';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    ...(development
      ? []
      : [`style-src-attr 'unsafe-hashes' ${styleAttributeSources}`]),
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self'${development ? ' ws:' : ''}`,
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  // Early hint only: no session cookie at all can never pass, so skip the
  // render. Whether a cookie is a live session is decided per entrypoint
  // (lib/access.ts), which rechecks the durable session every time.
  if (
    isGuardedPath(pathname) &&
    !SESSION_COOKIES.some((name) => request.cookies.has(name))
  ) {
    const next = returnDestination(`${pathname}${request.nextUrl.search}`);
    return new NextResponse(null, {
      status: 307,
      headers: {
        Location: `/sign-in?next=${encodeURIComponent(next)}`,
        'Content-Security-Policy': policy,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  }
  const headers = new Headers(request.headers);
  // Never trust caller-supplied identifiers; proxy ingress establishes correlation.
  headers.set('x-request-id', requestId);
  if (!isValidTraceparent(headers.get('traceparent')))
    headers.delete('traceparent');
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('x-request-id', requestId);
  return response;
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
