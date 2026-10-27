import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError, isAppError } from '@daisy/errors';
import { requireMessagingActor } from '../principal';
import { mayChallenge } from './friendship';
import type { FriendOperationDependencies } from './operations';

type ChallengeCommand = 'challenge' | 'decline';

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
  dependencies: FriendOperationDependencies,
): Promise<{ readonly username: string; readonly relation: 'friends' }> {
  const { actorId, userId } = requireMessagingActor(principal);
  await dependencies.limit(actorId);
  const otherActorId = await dependencies.lookup(input.username);
  if (!otherActorId || otherActorId === actorId)
    throw createAppError('NOT_FOUND');
  const capability =
    command === 'challenge' ? 'social.friend.request' : 'social.friend.end';
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
  return { username: input.username, relation: 'friends' };
}
