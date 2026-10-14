import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { MessagingReactionPolicy } from '@daisy/protocol';
import { readMessagingAuthority } from './authority-frame';
import { withMessagingChannel } from './channel-frame';
import { readMessagingStream } from './stream';
import { channelReactionFrame } from './reaction-frame';
import type {
  MessagingReactionFence,
  MessagingReactionStore,
} from './reaction-contracts';

/** Dedicated reaction methods share the existing account/pair/channel transaction fence. */
export function createMessagingReactionStore(
  database: BunSQLDatabase,
  policy: MessagingReactionPolicy,
  authorize: MessagingReactionFence,
): MessagingReactionStore {
  const frame = (
    scope: Parameters<MessagingReactionStore['read']>[0],
    work: (
      value: ReturnType<typeof channelReactionFrame>,
    ) => Promise<Awaited<ReturnType<MessagingReactionStore['read']>>>,
  ) =>
    withMessagingChannel(database, scope, ({ tx, stream, fact, accounts }) =>
      work(
        channelReactionFrame(
          tx,
          scope,
          stream.changeVersion,
          policy,
          (operation, association) =>
            authorize(tx, scope, { fact, accounts }, operation, association),
        ),
      ),
    );
  return {
    /** A summary read takes shared authority fences and the stream high-water mark. */
    read: (scope, messageId) =>
      readMessagingAuthority(
        database,
        scope,
        async ({ tx, fact, accounts }) => {
          const { changeVersion } = await readMessagingStream(
            tx,
            scope.channelId,
          );
          const value = channelReactionFrame(
            tx,
            scope,
            changeVersion,
            policy,
            (operation, association) =>
              authorize(tx, scope, { fact, accounts }, operation, association),
          );
          return value.read(messageId);
        },
      ),
    change: (scope, command, payloadDigest) =>
      frame(scope, (value) => value.change(command, payloadDigest)),
  };
}
