import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { messagingDmPairs } from '../schema/messaging-social';
import { messagingChannels } from '../schema/messaging-channels';
import type { ContactPairKey, ContactTransaction } from '../contacts/reactions';
import { advanceSocialChannelAuthority } from './social-channel-change';

/** A block or unblock changes who may post in the pair's DM: its authority advances. */
async function advanceDmOnBlock(tx: ContactTransaction, pair: ContactPairKey) {
  const [dm] = await tx
    .select()
    .from(messagingDmPairs)
    .where(
      and(
        eq(messagingDmPairs.lowActorId, pair.lowActorId),
        eq(messagingDmPairs.highActorId, pair.highActorId),
      ),
    );
  if (!dm) return;
  const [channel] = await tx
    .select()
    .from(messagingChannels)
    .where(eq(messagingChannels.id, dm.channelId))
    .for('update');
  if (!channel) throw createAppError('NOT_FOUND');
  await advanceSocialChannelAuthority(tx, channel);
}

/** Whether the pair has an accepted DM (DEC-251's relation). */
const acceptedDm = (pair: ContactPairKey) =>
  sql`exists(select 1 from ${messagingDmPairs}
    where ${messagingDmPairs.lowActorId} = ${pair.lowActorId}
      and ${messagingDmPairs.highActorId} = ${pair.highActorId}
      and ${messagingDmPairs.requestState} = 'accepted')`;

/** What Messaging registers with Contacts (ADR 0061). */
export const messagingContactReactions = {
  onBlock: advanceDmOnBlock,
  relation: acceptedDm,
};
