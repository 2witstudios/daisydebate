import { safeLocalDestination } from './redirect';
import { buildWrappedConfirmLink } from './wrapped-confirm-link';

/**
 * The emailed link opens a no-store confirmation page; the token is only
 * redeemed by an explicit same-origin POST (scanner safety). Destinations are
 * re-validated as local paths; Better Auth's absent-destination default "/"
 * becomes our /lobby.
 */
export function buildConfirmLink(origin: string, betterAuthUrl: string): URL {
  const link = buildWrappedConfirmLink('/auth/confirm', origin, betterAuthUrl);
  const newUser = new URL(betterAuthUrl).searchParams.get('newUserCallbackURL');
  if (newUser)
    link.searchParams.set('newUserCallbackURL', safeLocalDestination(newUser));
  return link;
}
