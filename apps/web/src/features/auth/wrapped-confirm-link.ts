import { safeLocalDestination } from './redirect';

/**
 * Shared shape behind every emailed link: it opens a no-store confirmation
 * page at `wrapperPath`, and the token is only redeemed by an explicit
 * same-origin POST (scanner safety). `callbackURL` is re-validated as a local
 * path; Better Auth's absent-destination default "/" becomes `fallback`.
 */
export function buildWrappedConfirmLink(
  wrapperPath: string,
  origin: string,
  betterAuthUrl: string,
  fallback?: string,
): URL {
  const source = new URL(betterAuthUrl);
  const link = new URL(wrapperPath, origin);
  link.searchParams.set('token', source.searchParams.get('token') ?? '');
  const requested = source.searchParams.get('callbackURL');
  link.searchParams.set(
    'callbackURL',
    safeLocalDestination(requested === '/' ? null : requested, fallback),
  );
  return link;
}
