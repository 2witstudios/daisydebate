import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  retrySharedRead,
  withSharedMessagingAuthority,
  withLockedMessagingAuthority,
} from './authority-frame';
import { lockMessagingStream, type MessagingStreamCounters } from './stream';
import type { MessagingChannelStore } from './records';
type Input = Parameters<MessagingChannelStore['withChannel']>[0];
type AuthorityWork = Parameters<typeof withSharedMessagingAuthority>[2];
type Frame = Parameters<AuthorityWork>[0] & {
  readonly tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
  readonly channel: typeof messagingChannels.$inferSelect;
  /** Locked after every authority fence: account -> pair -> channel -> stream. */
  readonly stream: MessagingStreamCounters;
};

async function streamFrame(
  authority: Parameters<AuthorityWork>[0],
  input: Input,
): Promise<Frame> {
  const { tx } = authority;
  const [channel] = await tx
    .select()
    .from(messagingChannels)
    .where(eq(messagingChannels.id, input.channelId));
  if (!channel) throw createAppError('NOT_FOUND');
  const stream = await lockMessagingStream(tx, channel.id);
  return { ...authority, tx, channel, stream };
}
/** Lifecycle writers own exclusive channel authority and use this same stream primitive. */
export async function withMessagingChannel<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  return database.transaction((tx) =>
    withLockedMessagingAuthority(tx, input, async (authority) =>
      work(await streamFrame(authority, input)),
    ),
  );
}
/** Content depends on compatible authority fences; only its stream is exclusive. */
export async function withMessagingContent<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  return retrySharedRead(database, (tx) =>
    withSharedMessagingAuthority(tx, input, async (authority) =>
      work(await streamFrame(authority, input)),
    ),
  );
}
