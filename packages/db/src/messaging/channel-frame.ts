import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  isCastChange,
  withLockedMessagingAuthority,
  withSharedMessagingAuthority,
} from './authority-frame';
import type { MessagingChannelStore } from './records';
type Input = Parameters<MessagingChannelStore['withChannel']>[0];
type AuthorityWork = Parameters<typeof withLockedMessagingAuthority>[2];
type Frame = Parameters<AuthorityWork>[0] & {
  readonly tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
  readonly channel: typeof messagingChannels.$inferSelect;
};

/** Adds the channel row, read after the authority fences, to the frame. */
const withChannelRow =
  <T>(tx: Frame['tx'], input: Input, work: (frame: Frame) => Promise<T>) =>
  async (authority: Parameters<AuthorityWork>[0]) => {
    const [channel] = await tx
      .select()
      .from(messagingChannels)
      .where(eq(messagingChannels.id, input.channelId));
    if (!channel) throw createAppError('NOT_FOUND');
    return work({ ...authority, tx, channel });
  };

/** Message/file readers extend the shared authority fence with their own counters. */
export async function withMessagingChannel<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  return database.transaction((tx) =>
    withLockedMessagingAuthority(tx, input, withChannelRow(tx, input, work)),
  );
}

/** Whole-transaction restarts a read takes when the cast keeps moving. */
const READ_RESTARTS = 2;
/**
 * The read counterpart (MSG-2.1-arch1): shared fences, no counter lock, and
 * a bounded restart of the whole transaction when the cast moved; still
 * moving after that is a retryable outage, never a stale answer.
 */
export async function readMessagingChannel<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.transaction((tx) =>
        withSharedMessagingAuthority(
          tx,
          input,
          withChannelRow(tx, input, work),
        ),
      );
    } catch (error) {
      if (!isCastChange(error)) throw error;
      if (attempt >= READ_RESTARTS)
        throw createAppError('INFRASTRUCTURE', undefined, error);
    }
  }
}
