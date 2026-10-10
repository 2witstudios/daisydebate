import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import { withLockedMessagingAuthority } from './authority-frame';
import type { MessagingChannelStore } from './records';
type Input = Parameters<MessagingChannelStore['withChannel']>[0];
type AuthorityWork = Parameters<typeof withLockedMessagingAuthority>[2];
type Frame = Parameters<AuthorityWork>[0] & {
  readonly tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
  readonly channel: typeof messagingChannels.$inferSelect;
};

/** Message/file readers extend the shared authority fence with their own counters. */
export async function withMessagingChannel<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  return database.transaction((tx) =>
    withLockedMessagingAuthority(tx, input, async (authority) => {
      const [channel] = await tx
        .select()
        .from(messagingChannels)
        .where(eq(messagingChannels.id, input.channelId));
      if (!channel) throw createAppError('NOT_FOUND');
      return work({ ...authority, tx, channel });
    }),
  );
}
