import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  restartingRead,
  withLockedMessagingAuthority,
  withSharedMessagingAuthority,
} from './authority-frame';
import type { MessagingChannelStore } from './records';
import { lockStream, readStream, type ChannelStream } from './stream';
type Input = Parameters<MessagingChannelStore['withChannel']>[0];
type AuthorityWork = Parameters<typeof withLockedMessagingAuthority>[2];
type Frame = Parameters<AuthorityWork>[0] & {
  readonly tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
  readonly channel: typeof messagingChannels.$inferSelect;
  readonly stream: ChannelStream;
};

type StreamRead = typeof readStream;
/**
 * Adds the channel row and its stream's high-water mark, read after the
 * authority fences, to the frame. A reader's `readStream` never locks the
 * stream row; a content writer's `lockStream` takes it before any other
 * content row (MSG-2.2-arch1).
 */
const withChannelRow =
  <T>(
    tx: Frame['tx'],
    input: Input,
    stream: StreamRead,
    work: (frame: Frame) => Promise<T>,
  ) =>
  async (authority: Parameters<AuthorityWork>[0]) => {
    const [channel] = await tx
      .select()
      .from(messagingChannels)
      .where(eq(messagingChannels.id, input.channelId));
    if (!channel) throw createAppError('NOT_FOUND');
    return work({
      ...authority,
      tx,
      channel,
      stream: await stream(tx, channel.id),
    });
  };

/**
 * Content writers (send, edit, removal, reactions, files): the same SHARE
 * fences as readers, in the same order (#484), then the stream row. Peer
 * writers and readers of the channel's authority never wait on each other;
 * same-channel appends are ordered by the stream lock; an authority change
 * (exclusive fence) still waits for them, and they for it (MSG-2.2-arch1).
 */
export async function withMessagingContent<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  return database.transaction((tx) =>
    withSharedMessagingAuthority(
      tx,
      input,
      withChannelRow(tx, input, lockStream, work),
    ),
  );
}

/** Authority changes on a channel (DM decisions): exclusive fences. */
export async function withMessagingAuthorityChange<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  return database.transaction((tx) =>
    withLockedMessagingAuthority(
      tx,
      input,
      withChannelRow(tx, input, readStream, work),
    ),
  );
}

/** The read counterpart (MSG-2.1-arch1): shared fences and no stream lock. */
export const readMessagingChannel = <T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> =>
  restartingRead(database, (tx) =>
    withSharedMessagingAuthority(
      tx,
      input,
      withChannelRow(tx, input, readStream, work),
    ),
  );
