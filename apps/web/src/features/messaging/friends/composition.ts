import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../../server/app';
import { consumeOrThrow } from '../../auth/abuse/rate-limit';
import { messagingHttpBoundary } from '../handler-boundary';
import { messagingSocialAuthorizationFence } from '../social-authorization';
import { createFriendHandlers } from './handlers';
import {
  changeFriendship,
  friendPresenceOf,
  readFriendList,
  type FriendReadDependencies,
} from './operations';
import type { FriendshipCommand } from './friendship';

/** Friend changes per member per minute: generous for people, not for scripts. */
const FRIEND_RULE = { windowSeconds: 60, max: 30 } as const;

const friendReads = (app: App): FriendReadDependencies => ({
  list: (actorId) => app.database.listMessagingFriendships(actorId),
  presence: async (actorIds) =>
    new Map(
      [...(await app.redis.readActorsPresence(actorIds))].map(
        ([actorId, activity]) => [actorId, friendPresenceOf(activity)],
      ),
    ),
});

/** The member's own friend list, for pages and the list route. */
const composeFriendList = (app: App) => {
  const reads = friendReads(app);
  return (principal: AuthorizationPrincipal) =>
    readFriendList(principal, reads);
};

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
