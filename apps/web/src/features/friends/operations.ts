import type { PublicProfileCard } from '@daisy/db/stores/profiles';
import type { SocialRequestLimits } from '@daisy/db/stores/contacts';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { DiscoverActor } from '../account/username-discovery';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { FriendshipRow, FriendStore } from '@daisy/db/friends';
import { createAppError, isAppError } from '@daisy/errors';
import type { FriendCommandResult, FriendList } from '@daisy/protocol/friends';
import type { MemberStatus } from '@daisy/protocol/presence-setting';
import type { PresenceActivity } from '@daisy/protocol/realtime';

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
              ...(facts.guardianHolds
                ? { guardianHolds: facts.guardianHolds }
                : {}),
              requestId: dependencies.ids.next(),
              now: dependencies.clock.now(),
              limits: dependencies.limits,
              nextId: () => dependencies.ids.next(),
            });
          return {
            username,
            relation: friendRelationOf(
              actorId,
              decision.next,
              facts.guardianHolds,
            ),
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

/** The list page's reads: the badge's, and what each friend chose to show. */
export type FriendListDependencies = FriendReadDependencies & {
  /** Each friend's display name and published photo (ADR 0143), in one read. */
  readonly profiles: (
    actorIds: readonly string[],
  ) => Promise<ReadonlyMap<string, PublicProfileCard>>;
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
export const friendsOnlineOf = (
  friends: readonly { readonly presence: MemberStatus }[],
): number => friends.filter((friend) => friend.presence !== 'offline').length;

/** The principal's rows and each accepted friend's presence, online first. */
async function friendsWithPresence(
  principal: AuthorizationPrincipal,
  dependencies: FriendReadDependencies,
  /** The friends' cards, read beside their presence rather than after it. */
  cards?: (
    actorIds: readonly string[],
  ) => Promise<ReadonlyMap<string, PublicProfileCard>>,
) {
  const { actorId, userId } = requireMemberActor(principal);
  const rows = await dependencies.list({ userId, actorId });
  const accepted = rows.filter((row) => row.state === 'accepted');
  // A friend appearing offline is offline to everyone (ADR 0103): their
  // leases are never even read.
  const visible = accepted.filter(
    (row) => row.otherChosen !== 'appearing_offline',
  );
  const [activity, profiles] = await Promise.all([
    visible.length
      ? dependencies.presence(visible.map((row) => row.otherActorId))
      : new Map<string, PresenceActivity | null>(),
    cards && accepted.length
      ? cards(accepted.map((row) => row.otherActorId))
      : new Map<string, PublicProfileCard>(),
  ]);
  const friends = accepted
    .map((row) => ({
      actorId: row.otherActorId,
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
    );
  return { actorId, rows, friends, profiles };
}

/** The shell badge: friends online or away, with no profile read. */
export async function countFriendsOnline(
  principal: AuthorizationPrincipal,
  dependencies: FriendReadDependencies,
): Promise<number> {
  return friendsOnlineOf(
    (await friendsWithPresence(principal, dependencies)).friends,
  );
}

/** The principal's friends, online first, and their pending requests. */
export async function readFriendList(
  principal: AuthorizationPrincipal,
  dependencies: FriendListDependencies,
): Promise<Omit<FriendList, 'version'>> {
  const { actorId, rows, friends, profiles } = await friendsWithPresence(
    principal,
    dependencies,
    dependencies.profiles,
  );
  const pending = (incoming: boolean) =>
    rows
      .filter(
        (row) =>
          row.state !== 'accepted' &&
          (row.requesterActorId !== actorId) === incoming,
      )
      .map(({ username, requestedAt, waiting }) => ({
        username,
        requestedAt,
        ...(waiting ? { waiting } : {}),
      }));
  return {
    friends: friends.map(({ actorId: friendId, username, presence }) => ({
      username,
      presence,
      displayName: profiles.get(friendId)?.displayName ?? null,
      photoId: profiles.get(friendId)?.photoId ?? null,
    })),
    incoming: pending(true),
    outgoing: pending(false),
  };
}
