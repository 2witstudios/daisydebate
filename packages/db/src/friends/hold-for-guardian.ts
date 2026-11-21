import { oweNotifications } from '../notifications/owe';
import { friendGuardianApprovals } from '../schema/friends';
import type { Tx } from '../tx';
import { activeGuardianUsers } from '../guardians/protection-level';

/** The request pair and the child's account are already locked by the caller. */
export async function holdForGuardian(
  tx: Pick<Tx, 'execute' | 'insert'>,
  input: {
    readonly pair: {
      readonly lowActorId: string;
      readonly highActorId: string;
    };
    readonly childActorId: string;
    readonly at: string;
    readonly nextId: () => string;
  },
) {
  const { pair, childActorId, at, nextId } = input;
  await tx
    .insert(friendGuardianApprovals)
    .values({
      id: nextId(),
      lowActorId: pair.lowActorId,
      highActorId: pair.highActorId,
      childActorId,
    })
    .onConflictDoNothing();

  const guardians = await activeGuardianUsers(tx, childActorId);
  await oweNotifications(tx, {
    kind: 'friend_guardian_approval',
    subject: {
      friendship_low_actor_id: pair.lowActorId,
      friendship_high_actor_id: pair.highActorId,
    },
    recipients: guardians.map(({ user_id }) => ({
      userId: user_id,
      about: childActorId,
    })),
    at,
    nextId,
  });
}
