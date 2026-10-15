import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannelStreams } from '../schema/messaging-channels';

type Tx = Pick<BunSQLDatabase, 'select' | 'update'>;
export type MessagingStreamCounters = {
  readonly messageSequence: number;
  readonly changeVersion: number;
};
const counters = {
  messageSequence: messagingChannelStreams.messageSequence,
  changeVersion: messagingChannelStreams.changeVersion,
};
const MAX_ORDER = Number.MAX_SAFE_INTEGER;

/** The stream's committed high-water mark; readers never lock the hot stream row. */
export async function readMessagingStream(
  tx: Pick<BunSQLDatabase, 'select'>,
  channelId: string,
): Promise<MessagingStreamCounters> {
  const [row] = await tx
    .select(counters)
    .from(messagingChannelStreams)
    .where(eq(messagingChannelStreams.channelId, channelId));
  if (!row) throw createAppError('NOT_FOUND');
  return row;
}
/**
 * The one exclusive stream section, taken after every authority fence and
 * before child rows (canonical order). Writers then advance from these counters.
 */
export async function lockMessagingStream(
  tx: Tx,
  channelId: string,
): Promise<MessagingStreamCounters> {
  const [row] = await tx
    .select(counters)
    .from(messagingChannelStreams)
    .where(eq(messagingChannelStreams.channelId, channelId))
    .for('update');
  if (!row) throw createAppError('NOT_FOUND');
  return row;
}
/**
 * Advance a locked stream once for a whole write: new messages take the next
 * sequences, and every change (including each new message) the next change
 * versions. The whole allocation is checked before any write, so overflow
 * rolls the write back instead of rounding or allocating a partial prefix.
 */
export async function advanceMessagingStream(
  tx: Tx,
  channelId: string,
  locked: MessagingStreamCounters,
  allocation: { readonly messages: number; readonly changes: number },
): Promise<MessagingStreamCounters> {
  const { messages, changes } = allocation;
  if (
    !Number.isSafeInteger(messages) ||
    !Number.isSafeInteger(changes) ||
    messages < 0 ||
    changes < messages ||
    changes === 0 ||
    messages > MAX_ORDER - locked.messageSequence ||
    changes > MAX_ORDER - locked.changeVersion
  )
    throw createAppError('INFRASTRUCTURE', 'Messaging stream exhausted');
  const next = {
    messageSequence: locked.messageSequence + messages,
    changeVersion: locked.changeVersion + changes,
  };
  await tx
    .update(messagingChannelStreams)
    .set(next)
    .where(eq(messagingChannelStreams.channelId, channelId));
  return next;
}
