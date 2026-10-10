import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { channelFileFrame, type FileStore } from '../messaging-files';
import { scopeFileFrame } from './file-capability';
import { withMessagingChannel } from './channel-frame';
import type { MessagingAuthorizationFence } from './records';

/** Files share the message transaction fence, never a nested transaction. */
export function createMessagingFileStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: (
    capability: 'post' | 'read',
  ) => MessagingAuthorizationFence;
}): FileStore {
  return {
    withChannel: (input, capability, work) =>
      withMessagingChannel(
        database,
        input,
        async ({ tx, channel, fact, accounts }) => {
          const refresh = () =>
            authorize(capability)(tx, input, { fact, accounts });
          const counters = {
            channelId: channel.id,
            changeVersion: channel.changeVersion,
          };
          return work(
            scopeFileFrame(
              channelFileFrame(tx, input, counters, refresh),
              capability,
            ),
          );
        },
      ),
  };
}
