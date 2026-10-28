import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { MessagingReactionPolicy } from '@daisy/protocol';
import { readMessagingChannel, withMessagingChannel } from './channel-frame';
import { channelReactionFrame } from './reaction-frame';
import type {
  MessagingReactionFence,
  MessagingReactionStore,
} from './reaction-contracts';

/**
 * Dedicated reaction methods on the account/pair/channel fence: a change
 * takes it exclusively, a summary read shares it (MSG-2.1-arch1).
 */
export function createMessagingReactionStore(
  database: BunSQLDatabase,
  policy: MessagingReactionPolicy,
  authorize: MessagingReactionFence,
): MessagingReactionStore {
  const frame = (
    fence: typeof readMessagingChannel,
    scope: Parameters<MessagingReactionStore['read']>[0],
    work: (
      value: ReturnType<typeof channelReactionFrame>,
    ) => Promise<Awaited<ReturnType<MessagingReactionStore['read']>>>,
  ) =>
    fence(database, scope, ({ tx, channel, fact, accounts }) =>
      work(
        channelReactionFrame(
          tx,
          scope,
          channel.changeVersion,
          policy,
          (operation, association) =>
            authorize(tx, scope, { fact, accounts }, operation, association),
        ),
      ),
    );
  return {
    read: (scope, messageId) =>
      frame(readMessagingChannel, scope, (value) => value.read(messageId)),
    change: (scope, command, payloadDigest) =>
      frame(withMessagingChannel, scope, (value) =>
        value.change(command, payloadDigest),
      ),
  };
}
