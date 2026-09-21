import { APIError } from 'better-auth/api';
import { recipientHash } from './mail';
import { safeLocalDestination } from './redirect';
import { unavailable } from './public-errors';
import type { AuthDeliveryLedger, AuthRateLimiter } from './server';

/** Per client (plugin rule) and per recipient (gate): 3 per 60 seconds. */
export const MAGIC_LINK_LIMIT = { windowSeconds: 60, max: 3 } as const;

type MagicLinkBody = {
  readonly email?: unknown;
  readonly callbackURL?: unknown;
  readonly newUserCallbackURL?: unknown;
  readonly errorCallbackURL?: unknown;
};

/** Local paths only: external, protocol-relative and encoded forms fail. */
function assertLocalDestinations(body: MagicLinkBody) {
  for (const destination of [
    body.callbackURL,
    body.newUserCallbackURL,
    body.errorCallbackURL,
  ])
    if (
      destination !== undefined &&
      (typeof destination !== 'string' ||
        safeLocalDestination(destination, '') === '')
    )
      throw new APIError('FORBIDDEN', {
        code: 'INVALID_CALLBACK_URL',
        message: 'Invalid callback URL',
      });
}

/**
 * Pre-send gate for `/sign-in/magic-link`: destination validation, the
 * per-recipient counter and the suppression check. A limiter or ledger
 * failure is a safe 503 — never an allow.
 */
export function createMagicLinkGate(dependencies: {
  readonly secret: string;
  readonly limiter: AuthRateLimiter;
  readonly ledger: AuthDeliveryLedger;
}) {
  return async (body: MagicLinkBody | undefined) => {
    assertLocalDestinations(body ?? {});
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) return;
    const digest = recipientHash(dependencies.secret, email);
    let allowed: { allowed: boolean; retryAfterSeconds: number };
    let suppressed = false;
    try {
      allowed = await dependencies.limiter.consume(
        `magic-link-recipient|${digest}`,
        MAGIC_LINK_LIMIT,
      );
      if (allowed.allowed)
        suppressed = await dependencies.ledger.isSuppressed(digest);
    } catch {
      throw unavailable(
        'AUTH_TEMPORARILY_UNAVAILABLE',
        'Sign-in is temporarily unavailable. Please try again shortly.',
      );
    }
    if (!allowed.allowed)
      throw new APIError(
        'TOO_MANY_REQUESTS',
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
        },
        { 'Retry-After': String(allowed.retryAfterSeconds) },
      );
    if (suppressed)
      // A prior hard bounce or complaint: never loop automatic resends.
      throw new APIError('UNPROCESSABLE_ENTITY', {
        code: 'EMAIL_UNDELIVERABLE',
        message:
          'We cannot send sign-in emails to this address. Sign in with a passkey or use a different address.',
      });
  };
}
