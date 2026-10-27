import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../../server/app';
import { consumeOrThrow } from '../../auth/abuse/rate-limit';
import { requireMessagingAuthorization } from '../authorization';
import { messagingHttpBoundary } from '../handler-boundary';
import { messagingSocialAuthorizationFence } from '../social-authorization';
import { createFriendHandlers } from './handlers';
import { setPresenceHidden } from './presence-setting';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import {
  changeFriendship,
  friendPresenceOf,
  readFriendList,
  type FriendReadDependencies,
} from './operations';
import type { FriendshipCommand } from './friendship';

/** Friend changes per member per minute: generous for people, not for scripts. */
const FRIEND_RULE = { windowSeconds: 60, max: 30 } as const;

/** The decision over the principal's own collection, on their locked account. */
const ownFence =
  (
    principal: AuthorizationPrincipal,
    capability: 'social.friend.list' | 'social.presence.update',
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireMessagingAuthorization({
      principal,
      capability,
      resource: { kind: 'messaging_collection', actorId: scope.actorId },
      context: { account },
    });

const friendReads = (
  app: App,
  principal: AuthorizationPrincipal,
): FriendReadDependencies => ({
  list: (scope) =>
    app.database.listMessagingFriendships(
      scope,
      ownFence(principal, 'social.friend.list'),
    ),
  hidden: (scope) =>
    app.database.readPresenceHidden(
      scope,
      ownFence(principal, 'social.friend.list'),
    ),
  presence: async (actorIds) =>
    new Map(
      [...(await app.redis.readActorsPresence(actorIds))].map(
        ([actorId, activity]) => [actorId, friendPresenceOf(activity)],
      ),
    ),
});

/** The member's own friend list, for pages and the list route. */
const composeFriendList = (app: App) => (principal: AuthorizationPrincipal) =>
  readFriendList(principal, friendReads(app, principal));

/** One friendship change through the contact fence for the principal. */
const composeFriendChange =
  (app: App) =>
  (
    principal: AuthorizationPrincipal,
    command: FriendshipCommand,
    username: string,
  ) =>
    changeFriendship(principal, command, username, {
      clock: app.clock,
      limit: (actorId) =>
        consumeOrThrow(app.auth().limiter, `friends:${actorId}`, FRIEND_RULE),
      lookup: (name) => app.database.lookupHumanActorByUsername(name),
      store: (capability) =>
        app.database.messagingSocialStore(
          messagingSocialAuthorizationFence({
            principal,
            clock: app.clock,
            operation: { kind: 'friend', capability },
          }),
        ),
    });

export function composeFriendRoutes(app: App) {
  const list = composeFriendList(app);
  return createFriendHandlers({
    boundary: messagingHttpBoundary(app),
    change: composeFriendChange(app),
    presence: (principal, hidden) =>
      setPresenceHidden(principal, hidden, {
        clock: app.clock,
        limit: (actorId) =>
          consumeOrThrow(app.auth().limiter, `friends:${actorId}`, FRIEND_RULE),
        write: (scope, input) =>
          app.database.writePresenceHidden(
            scope,
            input,
            ownFence(principal, 'social.presence.update'),
          ),
      }),
    list,
    websocketEndpoint: app.websocketEndpoint,
    counts: async (principal) => {
      const [{ friends }, membersOnline] = await Promise.all([
        list(principal),
        app.redis.countOnlinePresence(),
      ]);
      return {
        friendsOnline: friends.filter((friend) => friend.presence !== 'offline')
          .length,
        membersOnline,
      };
    },
  });
}
