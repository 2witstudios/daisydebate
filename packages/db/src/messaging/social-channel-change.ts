import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import { messagingChannels } from '../schema/messaging-channels';
import { appendOutboxEvent } from '../outbox';
type Tx = Pick<BunSQLDatabase, 'execute' | 'insert' | 'update'>;

export async function advanceSocialChannelAuthority(
  tx: Tx,
  channel: typeof messagingChannels.$inferSelect,
) {
  const changeVersion = channel.changeVersion + 1,
    authorityRevision = channel.authorityRevision + 1;
  if (![changeVersion, authorityRevision].every(Number.isSafeInteger))
    throw createAppError('CONFLICT');
  await tx
    .update(messagingChannels)
    .set({ changeVersion, authorityRevision })
    .where(eq(messagingChannels.id, channel.id));
  await appendOutboxEvent(tx, {
    topic: buildChannelTopic(channel.id),
    kind: 'channel.changed',
    version: 1,
    payload: { kind: 'channel.changed', channelId: channel.id, changeVersion },
  });
}
