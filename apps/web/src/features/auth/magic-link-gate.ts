import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { normalizeEmail, recipientKey } from './recipient-key';
import { safeLocalDestination } from './redirect';
import { unavailable } from './public-errors';
import type { AuthDeliveryLedger } from './mail-types';

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
 * Pre-send gate for `/sign-in/magic-link` (runs after the rate-limit gate):
 * destination validation and the suppression check. A ledger failure is a
 * safe 503 — never an allow.
 */
function createMagicLinkGate(dependencies: {
  readonly recipientSubkey: string;
  readonly ledger: AuthDeliveryLedger;
}) {
  return async (body: MagicLinkBody | undefined) => {
    assertLocalDestinations(body ?? {});
    const email =
      typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
    if (!email) return;
    let suppressed: boolean;
    try {
      suppressed = await dependencies.ledger.isSuppressed(
        recipientKey(dependencies.recipientSubkey, email),
      );
    } catch {
      throw unavailable(
        'AUTH_TEMPORARILY_UNAVAILABLE',
        'Sign-in is temporarily unavailable. Please try again shortly.',
      );
    }
    if (suppressed)
      // A prior hard bounce or complaint: never loop automatic resends.
      throw new APIError('UNPROCESSABLE_ENTITY', {
        code: 'EMAIL_UNDELIVERABLE',
        message:
          'We cannot send sign-in emails to this address. Sign in with a passkey or use a different address.',
      });
  };
}

/** Runs after the rate-limit gate: a throttled request does no lookups. */
export function createMagicLinkGatePlugin(dependencies: {
  readonly recipientSubkey: string;
  readonly ledger: AuthDeliveryLedger;
}): BetterAuthPlugin {
  const gate = createMagicLinkGate(dependencies);
  return {
    id: 'daisy-magic-link-gate',
    hooks: {
      before: [
        {
          matcher: (context) => context.path === '/sign-in/magic-link',
          handler: createAuthMiddleware(async (context) => {
            await gate(context.body);
          }),
        },
      ],
    },
  };
}
