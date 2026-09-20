import { NextResponse, type NextRequest } from 'next/server';
import { systemId } from '@daisy/clock';
import { isValidTraceparent } from '@daisy/observability';
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
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self'${development ? ' ws:' : ''}`,
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
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
