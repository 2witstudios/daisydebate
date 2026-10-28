import { invalidateDmInboxes } from './inbox-change';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import { appendStream } from './stream';
type Tx = Pick<BunSQLDatabase, 'execute' | 'insert' | 'update'>;

/**
 * An authority change is two writes: the channel's own `authority_revision`,
 * and one content revision on its stream (MSG-2.2-arch1). Observers see it
 * as a new disclosure revision in the owner's next header read (ADR 0089).
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
  await appendStream(tx, channel.id, {
    messages: 0,
    changes: 1,
  });
  await invalidateDmInboxes(tx, channel.id);
}
