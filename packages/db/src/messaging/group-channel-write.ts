import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
/** The channel fence is held; a stale authority revision still refuses all effects. */
export async function writeMessagingGroupLifecycle(
  tx: Pick<BunSQLDatabase, 'update'>,
  channelId: string,
  revision: number,
  lifecycle: 'active' | 'archived',
) {
  const [channel] = await tx
    .update(messagingChannels)
    .set({ lifecycle })
    .where(
      and(
        eq(messagingChannels.id, channelId),
        eq(messagingChannels.authorityRevision, revision),
      ),
    )
    .returning();
  if (!channel) throw createAppError('CONFLICT');
  return channel;
}
