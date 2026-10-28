import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { requireAuthorization } from '@daisy/auth/request-authorization';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import type { App } from '../../server/app';
import { consumeOrThrow } from '../../server/rate-limit';
import { memberHttpBoundary } from '../../server/member-handler';
import { createPresenceHandlers } from './handlers';
import { setPresenceHidden } from './setting';

/** Visibility toggles per member per minute, Presence's own budget. */
const PRESENCE_RULE = { windowSeconds: 60, max: 30 } as const;

/** The decision over the member's own presence setting, on their locked account. */
const ownSetting =
  (
    principal: AuthorizationPrincipal,
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability: 'social.presence.update',
      resource: { kind: 'presence_setting', actorId: scope.actorId },
      context: { account },
    });

export function composePresenceRoutes(app: App) {
  return createPresenceHandlers({
    boundary: memberHttpBoundary(app),
    set: (principal, hidden) =>
      setPresenceHidden(principal, hidden, {
        clock: app.clock,
        limit: (actorId) =>
          consumeOrThrow(
            app.limiter,
            `presence:${actorId}`,
            PRESENCE_RULE,
          ),
        write: (scope, input) =>
          app.database.writePresenceHidden(scope, input, ownSetting(principal)),
      }),
  });
}
