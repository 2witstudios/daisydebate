import { safeLocalDestination } from './redirect';

/**
 * The emailed sign-in link opens a no-store confirmation page; the token is
 * only redeemed by an explicit same-origin POST (scanner safety). Besides
 * the opaque token (ISSUE-2) the link keeps only the requested local
 * destinations, re-validated here and again on redemption; they grant
 * nothing. Better Auth's absent-destination default "/" becomes our /lobby.
 */
export function buildConfirmLink(origin: string, betterAuthUrl: string): URL {
  const source = new URL(betterAuthUrl).searchParams;
  const link = new URL('/auth/confirm', origin);
  link.searchParams.set('token', source.get('token') ?? '');
  const requested = source.get('callbackURL');
  link.searchParams.set(
    'callbackURL',
    safeLocalDestination(requested === '/' ? null : requested),
  );
  const newUser = source.get('newUserCallbackURL');
  if (newUser)
    link.searchParams.set('newUserCallbackURL', safeLocalDestination(newUser));
  return link;
}
