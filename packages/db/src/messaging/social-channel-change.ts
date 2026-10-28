import { invalidateDmInboxes } from './inbox-change';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import { messagingChannels } from '../schema/messaging-channels';
import { appendOutboxEvent } from '../outbox';
import { appendStream } from './stream';
type Tx = Pick<BunSQLDatabase, 'execute' | 'insert' | 'update'>;

/**
 * An authority change is two writes: the channel's own `authority_revision`,
 * and one content revision on its stream (MSG-2.2-arch1).
 */
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
  const { changeVersion } = await appendStream(tx, channel.id, {
    messages: 0,
    changes: 1,
  });
  await appendOutboxEvent(tx, {
    topic: buildChannelTopic(channel.id),
    kind: 'channel.changed',
    version: 1,
    payload: { kind: 'channel.changed', channelId: channel.id, changeVersion },
  });
  await invalidateDmInboxes(tx, channel.id);
}
