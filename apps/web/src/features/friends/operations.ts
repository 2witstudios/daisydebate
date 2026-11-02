import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { DiscoverActor } from '../account/username-discovery';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { SocialRequestLimits } from '@daisy/db';
import type { FriendshipRow, FriendStore } from '@daisy/db/friends';
import { createAppError, isAppError } from '@daisy/errors';
import type {
  FriendCommandResult,
  FriendList,
  MemberStatus,
  PresenceActivity,
} from '@daisy/protocol';

import {
  decideFriendship,
  friendRelationOf,
  type FriendshipCommand,
  type FriendshipRefusal,
} from './friendship';
import { requireMemberActor } from '../access/actor';
import { displayStatus } from '../presence/status';

export type FriendCapability = 'social.friend.request' | 'social.friend.end';

/** Asking and accepting need a clear pair; declining and removing never do. */
export const capabilityFor = (command: FriendshipCommand): FriendCapability =>
  command === 'request' || command === 'accept'
    ? 'social.friend.request'
    : 'social.friend.end';

export type FriendOperationDependencies = {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** DEC-251: a friend request spends the shared social request budgets. */
  readonly limits: SocialRequestLimits;
  readonly limit: (actorId: string) => Promise<void>;
  /** The one username port: it spends discovery before each lookup. */
  readonly discover: DiscoverActor;
  /** The social store behind the authorize fence for this capability. */
  readonly store: (capability: FriendCapability) => FriendStore;
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
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const otherActorId = await dependencies.discover(actorId, username);
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
              requestId: dependencies.ids.next(),
              now: dependencies.clock.now(),
              limits: dependencies.limits,
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
  }) => Promise<readonly FriendshipRow[]>;
  /** Each actor's presence; only friends are ever asked about. */
  readonly presence: (
    actorIds: readonly string[],
  ) => Promise<ReadonlyMap<string, PresenceActivity | null>>;
};

const statusRank: Record<MemberStatus, number> = {
  online: 0,
  busy: 1,
  room: 2,
  round: 3,
  away: 4,
  offline: 5,
};

/** How many of a friend list's friends the badge counts: away is still here. */
export const friendsOnlineOf = (friends: FriendList['friends']): number =>
  friends.filter((friend) => friend.presence !== 'offline').length;

/** The principal's friends, online first, and their pending requests. */
export async function readFriendList(
  principal: AuthorizationPrincipal,
  dependencies: FriendReadDependencies,
): Promise<Omit<FriendList, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  const rows = await dependencies.list({ userId, actorId });
  const accepted = rows.filter((row) => row.state === 'accepted');
  // A friend appearing offline is offline to everyone (ADR 0097): their
  // leases are never even read.
  const visible = accepted.filter((row) => row.otherChosen !== 'offline');
  const activity = visible.length
    ? await dependencies.presence(visible.map((row) => row.otherActorId))
    : new Map<string, PresenceActivity | null>();
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
        presence: displayStatus({
          chosen: row.otherChosen,
          activity: activity.get(row.otherActorId) ?? null,
          placement: row.otherPlacement,
        }),
      }))
      .sort(
        (a, b) =>
          statusRank[a.presence] - statusRank[b.presence] ||
          a.username.localeCompare(b.username),
      ),
    incoming: pending(true),
    outgoing: pending(false),
  };
}
