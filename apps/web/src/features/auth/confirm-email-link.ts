import { buildWrappedConfirmLink } from './wrapped-confirm-link';

/**
 * Wraps a Better Auth `/verify-email` URL (either the old-address approval
 * hop or the new-address verification hop; both use the same query shape)
 * behind a no-store confirmation page redeemed only by an explicit
 * same-origin POST (scanner safety), exactly like `buildConfirmLink`.
 */
export function buildConfirmEmailLink(
  origin: string,
  betterAuthUrl: string,
): URL {
  return buildWrappedConfirmLink(
    '/auth/confirm-email',
    origin,
    betterAuthUrl,
    '/settings/security',
  );
}
