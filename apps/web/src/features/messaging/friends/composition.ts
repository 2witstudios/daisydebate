import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../../server/app';
import { consumeOrThrow } from '../../auth/abuse/rate-limit';
import { requireMessagingAuthorization } from '../authorization';
import { messagingHttpBoundary } from '../handler-boundary';
import { messagingSocialAuthorizationFence } from '../social-authorization';
import { createFriendHandlers } from './handlers';
import { changeChallenge } from './challenge-operations';
import {
  changeFriendship,
  type FriendOperationDependencies,
  friendPresenceOf,
  readFriendList,
  type FriendReadDependencies,
} from './operations';

/** Friend changes per member per minute: generous for people, not for scripts. */
const FRIEND_RULE = { windowSeconds: 60, max: 30 } as const;

const friendReads = (
  app: App,
  principal: AuthorizationPrincipal,
): FriendReadDependencies => {
  const fence = (
    scope: { readonly actorId: string },
    account: Parameters<
      Parameters<typeof app.database.listMessagingFriendships>[1]
    >[0]['account'],
  ) =>
    requireMessagingAuthorization({
      principal,
      capability: 'social.friend.list',
      resource: { kind: 'messaging_collection', actorId: scope.actorId },
      context: { account },
    });
  return {
    list: (scope) =>
      app.database.listMessagingFriendships(scope, async ({ account }) =>
        fence(scope, account),
      ),
    challenges: (scope) =>
      app.database.listMessagingFriendChallenges(scope, async ({ account }) =>
        fence(scope, account),
      ),
    presence: async (actorIds) =>
      new Map(
        [...(await app.redis.readActorsPresence(actorIds))].map(
          ([actorId, activity]) => [actorId, friendPresenceOf(activity)],
        ),
      ),
  };
};

/** The member's own friend list, for pages and the list route. */
const composeFriendList = (app: App) => (principal: AuthorizationPrincipal) =>
  readFriendList(principal, friendReads(app, principal));

/** The operations' ports for the principal: limiter, lookup and fenced store. */
const friendPorts = (
  app: App,
  principal: AuthorizationPrincipal,
): FriendOperationDependencies => ({
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
    change: (principal, command, username) =>
      changeFriendship(
        principal,
        command,
        username,
        friendPorts(app, principal),
      ),
    challenge: (principal, command, input) =>
      changeChallenge(principal, command, input, friendPorts(app, principal)),
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
