import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  messagingContactPairs,
  messagingDmPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { messagingChannels } from '../schema/messaging-channels';
import { advanceSocialChannelAuthority } from './social-channel-change';
import type {
  MessagingSocialFrame,
  MessagingSocialInput,
} from './social-contracts';

export function contactBlockWriter(
  tx: Pick<BunSQLDatabase, 'select' | 'update' | 'insert' | 'execute'>,
  input: MessagingSocialInput,
  rows: readonly (typeof messagingContactPairs.$inferSelect)[],
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
      .update(messagingContactPairs)
      .set({
        revision,
        ...(ownsLow
          ? { lowBlocksHigh: command.blocked }
          : { highBlocksLow: command.blocked }),
      })
      .where(
        and(
          eq(messagingContactPairs.lowActorId, pair.lowActorId),
          eq(messagingContactPairs.highActorId, pair.highActorId),
        ),
      )
      .returning();
    if (!updated) throw createAppError('NOT_FOUND');
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
      requestId: command.requestId,
      kind: 'dm.block',
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

function requireChannel<T>(channel: T | undefined): asserts channel is T {
  if (!channel) throw createAppError('NOT_FOUND');
}
