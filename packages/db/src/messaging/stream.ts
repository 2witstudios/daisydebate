import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';

type StreamTransaction = Pick<BunSQLDatabase, 'execute'>;
/** The channel stream's high-water mark: the last message position and content revision. */
export type ChannelStream = {
  readonly messageSequence: number;
  readonly changeVersion: number;
};
/** One writer's whole plan: new messages, and content revisions (each message is one). */
type StreamAppendPlan = {
  readonly messages: number;
  readonly changes: number;
};
type StreamAllocation = ChannelStream & {
  readonly sequences: readonly number[];
  readonly versions: readonly number[];
};

const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const range = (after: number, length: number) =>
  Array.from({ length }, (_, index) => after + index + 1);
const streamOf = (row: Record<string, unknown> | undefined) => {
  if (!row) throw createAppError('NOT_FOUND');
  return {
    messageSequence: Number(row.messageSequence),
    changeVersion: Number(row.changeVersion),
  };
};

/** Opens a new channel's stream at its first content revision (creation). */
export async function openStream(tx: StreamTransaction, channelId: string) {
  await tx.execute(sql`insert into messaging_channel_streams(channel_id, message_sequence, change_version)
    values(${channelId}, 0, 1)`);
}

/** A reader's MVCC view of the high-water mark: never locks the stream row. */
export async function readStream(
  tx: StreamTransaction,
  channelId: string,
): Promise<ChannelStream> {
  const [row] = await tx.execute(sql`
    select message_sequence as "messageSequence", change_version as "changeVersion"
    from messaging_channel_streams where channel_id=${channelId}
  `);
  return streamOf(row);
}

/**
 * The only stream writer (MSG-2.2-arch1). The caller already holds its
 * authority fences; the stream row is locked last, the whole plan is
 * allocated or refused (an overflow throws and rolls everything back), and
 * the counters are written once.
 */
export async function appendStream(
  tx: StreamTransaction,
  channelId: string,
  plan: StreamAppendPlan,
): Promise<StreamAllocation> {
  if (
    !count(plan.messages) ||
    !count(plan.changes) ||
    plan.changes < Math.max(plan.messages, 1)
  )
    throw createAppError('VALIDATION');
  const [locked] = await tx.execute(sql`
    select message_sequence as "messageSequence", change_version as "changeVersion"
    from messaging_channel_streams where channel_id=${channelId} for update
  `);
  const current = streamOf(locked);
  const next = {
    messageSequence: current.messageSequence + plan.messages,
    changeVersion: current.changeVersion + plan.changes,
  };
  if (
    !Number.isSafeInteger(next.messageSequence) ||
    !Number.isSafeInteger(next.changeVersion)
  )
    throw createAppError('CONFLICT');
  await tx.execute(sql`update messaging_channel_streams
    set message_sequence=${next.messageSequence}, change_version=${next.changeVersion}
    where channel_id=${channelId}`);
  return {
    ...next,
    sequences: range(current.messageSequence, plan.messages),
    versions: range(current.changeVersion, plan.changes),
  };
}
