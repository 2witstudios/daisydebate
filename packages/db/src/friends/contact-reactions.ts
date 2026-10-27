import { and, eq, sql } from 'drizzle-orm';
import { friendships } from '../schema/friends';
import type { ContactPairKey, ContactTransaction } from '../contacts/reactions';
import { endPairChallenges } from './challenge-frame';

/** A block ends any friendship or request and its challenges; unblocking never restores one. */
async function endFriendshipOnBlock(
  tx: ContactTransaction,
  pair: ContactPairKey,
  blocked: boolean,
) {
  if (!blocked) return;
  await tx
    .delete(friendships)
    .where(
      and(
        eq(friendships.lowActorId, pair.lowActorId),
        eq(friendships.highActorId, pair.highActorId),
      ),
    );
  await endPairChallenges(tx, pair);
}

/** Whether the pair is an accepted friendship (DEC-251's relation). */
const acceptedFriendship = (pair: ContactPairKey) =>
  sql`exists(select 1 from ${friendships}
    where ${friendships.lowActorId} = ${pair.lowActorId}
      and ${friendships.highActorId} = ${pair.highActorId}
      and ${friendships.state} = 'accepted')`;

/** What Friends registers with Contacts (ADR 0072). */
export const friendContactReactions = {
  onBlock: endFriendshipOnBlock,
  relation: acceptedFriendship,
};
