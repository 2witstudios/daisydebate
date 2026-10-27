import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type {
  MessagingFriendChallengeRow,
  MessagingFriendshipRow,
  MessagingSocialStore,
} from '@daisy/db/messaging';
import { createAppError, isAppError } from '@daisy/errors';
import type {
  FriendCommandResult,
  FriendList,
  FriendPresence,
  PresenceActivity,
} from '@daisy/protocol';
import { requireMessagingActor } from '../principal';
import {
  decideFriendship,
  friendRelationOf,
  type FriendshipCommand,
  type FriendshipRefusal,
} from './friendship';

export type FriendCapability = 'social.friend.request' | 'social.friend.end';

/** Asking and accepting need a clear pair; declining and removing never do. */
export const capabilityFor = (command: FriendshipCommand): FriendCapability =>
  command === 'request' || command === 'accept'
    ? 'social.friend.request'
    : 'social.friend.end';

export type FriendOperationDependencies = {
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
  readonly lookup: (username: string) => Promise<string | null>;
  /** The social store behind the authorize fence for this capability. */
  readonly store: (capability: FriendCapability) => MessagingSocialStore;
};

const refusalError = (refusal: FriendshipRefusal) =>
  createAppError(
    refusal === 'self'
      ? 'INVARIANT'
      : refusal === 'limit'
        ? 'RATE_LIMIT'
        : refusal === 'no-request'
          ? 'CONFLICT'
          : 'NOT_FOUND',
  );

/**
 * One friendship change for the principal's own actor (ADR 0072). The pair
 * is reloaded under the contact fence; a block, an erased member and an
 * unknown username all answer the same NOT_FOUND, so a refusal never says
 * which one it was.
 */
export async function changeFriendship(
  principal: AuthorizationPrincipal,
  command: FriendshipCommand,
  username: string,
  dependencies: FriendOperationDependencies,
): Promise<Omit<FriendCommandResult, 'version'>> {
  const { actorId, userId } = requireMessagingActor(principal);
  await dependencies.limit(actorId);
  const otherActorId = await dependencies.lookup(username);
  if (!otherActorId) throw createAppError('NOT_FOUND');
  if (otherActorId === actorId) throw refusalError('self');
  try {
    return await dependencies
      .store(capabilityFor(command))
      .withContacts(
        { actorId, userId, memberActorIds: [actorId, otherActorId] },
        async (frame) => {
          const facts = await frame.readFriendship();
          const decision = decideFriendship(
            {
              ...facts,
              actorId,
              blocked: frame.contacts[0]?.blocked ?? true,
            },
            command,
          );
          if (!decision.ok) throw refusalError(decision.refusal);
          if (decision.changed)
            await frame.commitFriendship({
              previous: facts.pair,
              next: decision.next,
              now: dependencies.clock.now(),
            });
          return {
            username,
            relation: friendRelationOf(actorId, decision.next),
          };
        },
      );
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTHORIZATION')
      throw createAppError('NOT_FOUND');
    throw error;
  }
}

export type FriendReadDependencies = {
  /** The reader's own rows, behind the `social.friend.list` decision. */
  readonly list: (scope: {
    readonly userId: string;
    readonly actorId: string;
  }) => Promise<readonly MessagingFriendshipRow[]>;
  /** Friends' challenges waiting for the reader, behind the same decision. */
  readonly challenges: (scope: {
    readonly userId: string;
    readonly actorId: string;
  }) => Promise<readonly MessagingFriendChallengeRow[]>;
  /** Each actor's presence; only friends are ever asked about. */
  readonly presence: (
    actorIds: readonly string[],
  ) => Promise<ReadonlyMap<string, FriendPresence>>;
};

/** What a friend sees of a live lease: active is online, idle is away. */
export const friendPresenceOf = (
  activity: PresenceActivity | null,
): FriendPresence =>
  activity === 'active' ? 'online' : activity === 'idle' ? 'away' : 'offline';

const presenceRank: Record<FriendPresence, number> = {
  online: 0,
  away: 1,
  offline: 2,
};

/** The principal's friends, online first, and their pending requests. */
export async function readFriendList(
  principal: AuthorizationPrincipal,
  dependencies: FriendReadDependencies,
): Promise<Omit<FriendList, 'version'>> {
  const { actorId, userId } = requireMessagingActor(principal);
  const [rows, challenges] = await Promise.all([
    dependencies.list({ userId, actorId }),
    dependencies.challenges({ userId, actorId }),
  ]);
  const accepted = rows.filter((row) => row.state === 'accepted');
  const presence = accepted.length
    ? await dependencies.presence(accepted.map((row) => row.otherActorId))
    : new Map<string, FriendPresence>();
  const pending = (incoming: boolean) =>
    rows
      .filter(
        (row) =>
          row.state === 'pending' &&
          (row.requesterActorId !== actorId) === incoming,
      )
      .map(({ username, requestedAt }) => ({ username, requestedAt }));
  return {
    friends: accepted
      .map((row) => ({
        username: row.username,
        presence: presence.get(row.otherActorId) ?? 'offline',
      }))
      .sort(
        (a, b) =>
          presenceRank[a.presence] - presenceRank[b.presence] ||
          a.username.localeCompare(b.username),
      ),
    incoming: pending(true),
    outgoing: pending(false),
    challenges: challenges.map(({ username, roomId, title, challengedAt }) => ({
      username,
      roomId,
      title,
      challengedAt,
    })),
  };
}
