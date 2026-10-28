import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { DiscoverActor } from '../account/username-discovery';
import type { Clock } from '@daisy/clock';
import type { FriendStore } from '@daisy/db/friends';
import { createAppError, isAppError } from '@daisy/errors';
import type { ChallengeCommandResult } from '@daisy/protocol';

import { mayChallenge } from './friendship';
import { requireMemberActor } from '../access/actor';

type ChallengeCommand = 'challenge' | 'decline';
type ChallengeCapability = 'social.challenge.send' | 'social.challenge.decline';

/**
 * A challenge's own rate limit (S3): sending or declining spends this
 * bucket, never the friend-change budget (`friends:<actorId>`).
 */
export const challengeRateLimit = {
  key: (actorId: string) => `friend-challenges:${actorId}`,
  rule: { windowSeconds: 60, max: 30 },
} as const;

/** A challenge's own ports: its rate limit, lookup and fenced friend store. */
export type ChallengeOperationDependencies = {
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
  /** The one username port: it spends discovery before each lookup. */
  readonly discover: DiscoverActor;
  readonly store: (capability: ChallengeCapability) => FriendStore;
};

/**
 * Delivers a challenge to a friend, or declines one (ADR 0072), under the
 * pair's contact fence. Challenging needs an accepted friendship and a room
 * the caller hosts while it assembles; a block, a stranger or an unknown
 * name answers NOT_FOUND, never saying which. Declining is always open to
 * the challenged member.
 */
export async function changeChallenge(
  principal: AuthorizationPrincipal,
  command: ChallengeCommand,
  input: { readonly username: string; readonly roomId: string },
  dependencies: ChallengeOperationDependencies,
): Promise<Omit<ChallengeCommandResult, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const otherActorId = await dependencies.discover(actorId, input.username);
  if (!otherActorId || otherActorId === actorId)
    throw createAppError('NOT_FOUND');
  // A challenge is authorized by its own capabilities (no block either way
  // and both accounts current to send; declining is always open); the
  // accepted friendship is checked below under the same lock.
  const capability: ChallengeCapability =
    command === 'challenge'
      ? 'social.challenge.send'
      : 'social.challenge.decline';
  try {
    await dependencies
      .store(capability)
      .withContacts(
        { actorId, userId, memberActorIds: [actorId, otherActorId] },
        async (frame) => {
          if (command === 'decline')
            return frame.declineChallenge({ roomId: input.roomId });
          const { pair } = await frame.readFriendship();
          if (!mayChallenge(pair)) throw createAppError('NOT_FOUND');
          const { recorded } = await frame.commitChallenge({
            roomId: input.roomId,
            now: dependencies.clock.now(),
          });
          if (!recorded) throw createAppError('CONFLICT');
        },
      );
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTHORIZATION')
      throw createAppError('NOT_FOUND');
    throw error;
  }
  return {
    username: input.username,
    roomId: input.roomId,
    challenge: command === 'challenge' ? 'sent' : 'declined',
  };
}
