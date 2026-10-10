import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import { blockMessagingContact } from './block';
import { messagingSocialAuthorizationFence } from './social-authorization';
/** Both participant entry points use the same canonical, age-independent safety fence. */
export function composeMessagingBlockOperation(app: App) {
  return (input: unknown, principal: AuthorizationPrincipal) => {
    const social = app.messagingPolicy?.social;
    if (!social) throw createAppError('INFRASTRUCTURE');
    return blockMessagingContact(input, principal, {
      bounds: social.bounds,
      clock: app.clock,
      limit: (actorId) =>
        consumeOrThrow(
          app.auth().limiter,
          `messaging:social:${actorId}`,
          social.abuse,
        ),
      store: app.database.messagingSocialStore(
        messagingSocialAuthorizationFence({
          principal,
          clock: app.clock,
          operation: { kind: 'block' },
        }),
      ),
    });
  };
}
