import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { MessagingReactionPolicy } from '@daisy/protocol';
import { withMessagingChannel } from './channel-frame';
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
    withMessagingChannel(database, scope, ({ tx, channel, fact, accounts }) =>
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
    read: (scope, messageId) => frame(scope, (value) => value.read(messageId)),
    change: (scope, command, payloadDigest) =>
      frame(scope, (value) => value.change(command, payloadDigest)),
  };
}
