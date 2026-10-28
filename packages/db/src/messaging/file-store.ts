import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { channelFileFrame, type FileStore } from '../messaging-files';
import { scopeFileFrame } from './file-capability';
import { readMessagingChannel, withMessagingChannel } from './channel-frame';
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
    // A read takes the shared fences (MSG-2.1-arch1); posting keeps the
    // exclusive ones and the counter lock.
    withChannel: (input, capability, work) =>
      (capability === 'read' ? readMessagingChannel : withMessagingChannel)(
        database,
        input,
        async ({ tx, channel, stream, fact, accounts }) => {
          const refresh = () =>
            authorize(capability)(tx, input, { fact, accounts });
          const counters = {
            channelId: channel.id,
            changeVersion: stream.changeVersion,
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
