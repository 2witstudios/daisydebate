import { invalidateDmInboxes } from './inbox-change';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import { messagingChannels } from '../schema/messaging-channels';
import { appendOutboxEvent } from '../outbox';
import { advanceMessagingStream, lockMessagingStream } from './stream';
type Tx = Pick<BunSQLDatabase, 'execute' | 'insert' | 'update' | 'select'>;

/** The caller holds the channel's authority row; its stream row is locked next (canonical order). */
export async function advanceSocialChannelAuthority(
  tx: Tx,
  channel: typeof messagingChannels.$inferSelect,
) {
  const authorityRevision = channel.authorityRevision + 1;
  if (!Number.isSafeInteger(authorityRevision))
    throw createAppError('CONFLICT');
  await tx
    .update(messagingChannels)
    .set({ authorityRevision })
    .where(eq(messagingChannels.id, channel.id));
  const stream = await lockMessagingStream(tx, channel.id);
  const { changeVersion } = await advanceMessagingStream(
    tx,
    channel.id,
    stream,
    { messages: 0, changes: 1 },
  );
  await appendOutboxEvent(tx, {
    topic: buildChannelTopic(channel.id),
    kind: 'channel.changed',
    version: 1,
    payload: { kind: 'channel.changed', channelId: channel.id, changeVersion },
  });
  await invalidateDmInboxes(tx, channel.id);
}
