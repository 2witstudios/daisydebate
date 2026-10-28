import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { consumeOrThrow } from '../../server/rate-limit';
import { requireAuthorization } from '@daisy/auth/request-authorization';

import { createFriendHandlers } from './handlers';
import {
  challengeRateLimit,
  changeChallenge,
  type ChallengeOperationDependencies,
} from './challenge-operations';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import {
  changeFriendship,
  type FriendOperationDependencies,
  friendPresenceOf,
  friendsOnlineOf,
  readFriendList,
  type FriendReadDependencies,
} from './operations';
import { memberHttpBoundary } from '../../server/member-handler';
import { contactPairFence } from '../contacts/authorization';

/** Friend changes per member per minute: generous for people, not for scripts. */
const FRIEND_RULE = { windowSeconds: 60, max: 30 } as const;

/** The decision over the principal's own collection, on their locked account. */
const ownFence =
  (
    principal: AuthorizationPrincipal,
    capability: 'social.friend.list',
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability,
      resource: { kind: 'friend_collection', actorId: scope.actorId },
      context: { account },
    });

const friendReads = (
  app: App,
  principal: AuthorizationPrincipal,
): FriendReadDependencies => ({
  list: (scope) =>
    app.database.listFriendships(
      scope,
      ownFence(principal, 'social.friend.list'),
    ),
  challenges: (scope) =>
    app.database.listFriendChallenges(
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

/** The operations' ports for the principal: limiter, lookup and fenced store. */
const friendPorts = (
  app: App,
  principal: AuthorizationPrincipal,
): FriendOperationDependencies => ({
  clock: app.clock,
  ids: app.ids,
  limits: app.contactsPolicy.requests,
  limit: (actorId) =>
    consumeOrThrow(app.limiter, `friends:${actorId}`, FRIEND_RULE),
  lookup: (name) => app.database.lookupHumanActorByUsername(name),
  store: (capability) =>
    app.database.friendStore(contactPairFence({ principal, capability })),
});

/** A challenge's ports: its own limiter bucket and capability fence. */
const challengePorts = (
  app: App,
  principal: AuthorizationPrincipal,
): ChallengeOperationDependencies => ({
  clock: app.clock,
  limit: (actorId) =>
    consumeOrThrow(
      app.limiter,
      challengeRateLimit.key(actorId),
      challengeRateLimit.rule,
    ),
  lookup: (name) => app.database.lookupHumanActorByUsername(name),
  store: (capability) =>
    app.database.friendStore(contactPairFence({ principal, capability })),
});

export function composeFriendRoutes(app: App) {
  const list = composeFriendList(app);
  return createFriendHandlers({
    boundary: memberHttpBoundary(app),
    change: (principal, command, username) =>
      changeFriendship(
        principal,
        command,
        username,
        friendPorts(app, principal),
      ),
    challenge: (principal, command, input) =>
      changeChallenge(
        principal,
        command,
        input,
        challengePorts(app, principal),
      ),
    list,
    websocketEndpoint: app.websocketEndpoint,
    counts: async (principal) => {
      const [{ friends }, membersOnline] = await Promise.all([
        list(principal),
        app.redis.countOnlinePresence(),
      ]);
      return {
        friendsOnline: friendsOnlineOf(friends),
        membersOnline,
      };
    },
  });
}
