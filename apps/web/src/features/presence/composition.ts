import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { requireAuthorization } from '@daisy/auth/request-authorization';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import type { App } from '../../server/app';
import { consumeOrThrow } from '../../server/rate-limit';
import { memberHttpBoundary } from '../../server/member-handler';
import { createPresenceHandlers } from './handlers';
import { ROSTER_ACTORS_MAX } from '@daisy/db/presence-roster';
import { readOnlineRoster } from './online';
import { readChosen, setChosenStatus } from './setting';

/** Status changes per member per minute, Presence's own budget. */
const PRESENCE_RULE = { windowSeconds: 60, max: 30 } as const;
/** Online list reads per member per minute: rings, scrolling and a search box. */
const ONLINE_RULE = { windowSeconds: 60, max: 240 } as const;

/** The decision over the member's own presence setting, on their locked account. */
const ownSetting =
  (
    principal: AuthorizationPrincipal,
    capability: 'social.presence.read' | 'social.presence.update',
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability,
      resource: { kind: 'presence_setting', actorId: scope.actorId },
      context: { account },
    });

/** The decision over the member's own view of the list, on their locked account. */
const ownList =
  (principal: AuthorizationPrincipal): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability: 'social.online.list',
      resource: { kind: 'friend_collection', actorId: scope.actorId },
      context: { account },
    });

export function composePresenceRoutes(app: App) {
  return createPresenceHandlers({
    boundary: memberHttpBoundary(app),
    websocketEndpoint: app.websocketEndpoint,
    set: (principal, status) =>
      setChosenStatus(principal, status, {
        clock: app.clock,
        limit: (actorId) =>
          consumeOrThrow(app.limiter, `presence:${actorId}`, PRESENCE_RULE),
        write: (scope, input) =>
          app.database.writeChosenStatus(
            scope,
            input,
            ownSetting(principal, 'social.presence.update'),
          ),
      }),
    read: (principal) =>
      readChosen(principal, {
        read: (scope) =>
          app.database.readChosenStatus(
            scope,
            ownSetting(principal, 'social.presence.read'),
          ),
      }),
    online: (principal, input) =>
      readOnlineRoster(principal, input, {
        now: () => app.clock.now(),
        limit: (actorId) =>
          consumeOrThrow(app.limiter, `online:${actorId}`, ONLINE_RULE),
        onlineActorIds: () => app.redis.readOnlineActorIds(ROSTER_ACTORS_MAX),
        activity: (actorIds) => app.redis.readActorsPresence(actorIds),
        page: (scope, page) =>
          app.database.readRosterPage(scope, page, ownList(principal)),
        cards: (actorIds) => app.database.readMemberCards(actorIds),
        blinded: (actorId) => app.database.readRatingBlindings(actorId),
      }),
  });
}
