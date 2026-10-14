import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';

type Tx = Pick<BunSQLDatabase, 'execute'>;
export type MessagingStreamCounters = {
  readonly messageSequence: number;
  readonly changeVersion: number;
};
const MAX_ORDER = Number.MAX_SAFE_INTEGER;

/** The stream's committed high-water mark; readers never lock the hot stream row. */
export async function readMessagingStream(
  tx: Tx,
  channelId: string,
): Promise<MessagingStreamCounters> {
  const [row] = await tx.execute(
    sql`select message_sequence as "messageSequence", change_version as "changeVersion" from messaging_channel_streams where channel_id=${channelId}`,
  );
  if (!row) throw createAppError('NOT_FOUND');
  return checkedCounters(row);
}
/**
 * The one exclusive stream section, taken after every authority fence and
 * before child rows (canonical order). Writers then advance from these counters.
 */
export async function lockMessagingStream(
  tx: Tx,
  channelId: string,
): Promise<MessagingStreamCounters> {
  const [row] = await tx.execute(
    sql`select message_sequence as "messageSequence", change_version as "changeVersion" from messaging_channel_streams where channel_id=${channelId} for update`,
  );
  if (!row) throw createAppError('NOT_FOUND');
  return checkedCounters(row);
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
  await tx.execute(
    sql`update messaging_channel_streams set message_sequence=${next.messageSequence},change_version=${next.changeVersion} where channel_id=${channelId}`,
  );
  return next;
}

function checkedCounters(
  row: Record<string, unknown>,
): MessagingStreamCounters {
  const messageSequence = Number(row.messageSequence),
    changeVersion = Number(row.changeVersion);
  if (
    !Number.isSafeInteger(messageSequence) ||
    !Number.isSafeInteger(changeVersion) ||
    messageSequence < 0 ||
    changeVersion < messageSequence
  )
    throw createAppError('INFRASTRUCTURE', 'Invalid messaging stream');
  return { messageSequence, changeVersion };
}
