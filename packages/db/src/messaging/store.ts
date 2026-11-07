import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { readMessagingChannel, withMessagingContent } from './channel-frame';
import { channelReadFrame } from './read-frame';
import {
  messagingContentFrame,
  readMessageIn,
  readReceipt,
} from './content-frame';
import type {
  MessagingAuthorizationFence,
  MessagingChannelStore,
} from './records';

/** Scope-specific transaction frame; never exposes a raw database to delivery. */
export function createMessagingStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingAuthorizationFence;
}): MessagingChannelStore {
  return {
    readChannel: (input, work) =>
      readMessagingChannel(
        database,
        input,
        ({ tx, channel, stream, fact, accounts }) => {
          const authorizeRead = () => authorize(tx, input, { fact, accounts });
          const { history, changes, markRead } = channelReadFrame(
            tx,
            input,
            { channelId: channel.id, ...stream },
            authorizeRead,
          );
          return work({
            history,
            changes,
            markRead,
            authorize: authorizeRead,
            fact,
            accounts,
            async readRequestState({ requestId, messageId }) {
              await authorizeRead();
              if (
                !idSchema.safeParse(requestId).success ||
                (messageId !== undefined &&
                  !idSchema.safeParse(messageId).success)
              )
                throw createAppError('VALIDATION');
              return {
                counters: { channelId: channel.id, ...stream },
                receipt: await readReceipt(tx, input, requestId),
                message: await readMessageIn(tx, channel.id)(messageId ?? null),
              };
            },
          });
        },
      ),
    withChannel: async (input, work) => {
      return withMessagingContent(
        database,
        input,
        async ({ tx, channel, stream, fact, accounts }) => {
          return work({
            fact,
            accounts,
            ...messagingContentFrame(
              tx,
              input,
              { channelId: channel.id, ...stream },
              () => authorize(tx, input, { fact, accounts }),
            ),
          });
        },
      );
    },
  };
}
