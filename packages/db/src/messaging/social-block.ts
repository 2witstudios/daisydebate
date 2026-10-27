import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  messagingDmPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { contactPairs } from '../schema/contacts';
import { friendships } from '../schema/friends';
import { messagingChannels } from '../schema/messaging-channels';
import { advanceSocialChannelAuthority } from './social-channel-change';
import { endPairChallenges } from '../friends/challenge-frame';
import type { ContactInput } from '../contacts/fence';
import type { MessagingSocialFrame } from './social-contracts';

export function contactBlockWriter(
  tx: Pick<
    BunSQLDatabase,
    'select' | 'update' | 'insert' | 'delete' | 'execute'
  >,
  input: ContactInput,
  rows: readonly (typeof contactPairs.$inferSelect)[],
  authorize: () => Promise<void>,
): MessagingSocialFrame['commitBlock'] {
  return async (command) => {
    await authorize();
    if (rows.length !== 1) throw createAppError('VALIDATION');
    const pair = rows[0]!;
    const revision = pair.revision + 1;
    if (!Number.isSafeInteger(revision)) throw createAppError('CONFLICT');
    const ownsLow = pair.lowActorId === input.actorId;
    const [updated] = await tx
      .update(contactPairs)
      .set({
        revision,
        ...(ownsLow
          ? { lowBlocksHigh: command.blocked }
          : { highBlocksLow: command.blocked }),
      })
      .where(
        and(
          eq(contactPairs.lowActorId, pair.lowActorId),
          eq(contactPairs.highActorId, pair.highActorId),
        ),
      )
      .returning();
    if (!updated) throw createAppError('NOT_FOUND');
    await endFriendshipOnBlock(tx, pair, command.blocked);
    const [dm] = await tx
      .select()
      .from(messagingDmPairs)
      .where(
        and(
          eq(messagingDmPairs.lowActorId, pair.lowActorId),
          eq(messagingDmPairs.highActorId, pair.highActorId),
        ),
      );
    if (dm) {
      const [channel] = await tx
        .select()
        .from(messagingChannels)
        .where(eq(messagingChannels.id, dm.channelId))
        .for('update');
      requireChannel(channel);
      await advanceSocialChannelAuthority(tx, channel);
    }
    await tx.insert(messagingSocialCommands).values({
      actorId: input.actorId,
      counterpartActorId: ownsLow ? pair.highActorId : pair.lowActorId,
      requestId: command.requestId,
      kind: 'contact.block',
      digest: command.digest,
      createdAt: new Date(command.now),
      resultChannelId: dm?.channelId ?? null,
    });
    return {
      blocked: ownsLow ? updated.lowBlocksHigh : updated.highBlocksLow,
      revision,
    };
  };
}

/** A block ends any friendship or request; unblocking never restores one. */
async function endFriendshipOnBlock(
  tx: Pick<BunSQLDatabase, 'delete'>,
  pair: typeof contactPairs.$inferSelect,
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

function requireChannel<T>(channel: T | undefined): asserts channel is T {
  if (!channel) throw createAppError('NOT_FOUND');
}
