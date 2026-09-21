import { safeLocalDestination } from './redirect';

/**
 * The emailed link opens a no-store confirmation page; the token is only
 * redeemed by an explicit same-origin POST (scanner safety). Destinations are
 * re-validated as local paths; Better Auth's absent-destination default "/"
 * becomes our /lobby.
 */
export function buildConfirmLink(origin: string, betterAuthUrl: string): URL {
  const source = new URL(betterAuthUrl);
  const link = new URL('/auth/confirm', origin);
  link.searchParams.set('token', source.searchParams.get('token') ?? '');
  const requested = source.searchParams.get('callbackURL');
  link.searchParams.set(
    'callbackURL',
    safeLocalDestination(requested === '/' ? null : requested),
  );
  const newUser = source.searchParams.get('newUserCallbackURL');
  if (newUser)
    link.searchParams.set('newUserCallbackURL', safeLocalDestination(newUser));
  return link;
}
