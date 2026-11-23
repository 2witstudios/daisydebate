import { channelFileFrame, type FileStore } from '../messaging-files';
import { readMessagingChannel, withMessagingContent } from './channel-frame';
import type { MessagingAuthorizationFence } from './records';
import type { TxSource } from '../tx';
import { createAppError } from '@daisy/errors';
import type { FileFrame } from '../messaging-files';

/** Files share the message transaction fence, never a nested transaction. */
export function createMessagingFileStore({
  database,
  authorize,
}: {
  readonly database: TxSource;
  readonly authorize: (
    capability: 'post' | 'read',
  ) => MessagingAuthorizationFence;
}): FileStore {
  return {
    // A read takes the shared fences (MSG-2.1-arch1); posting keeps the
    // exclusive ones and the counter lock.
    withChannel: (input, capability, work) =>
      (capability === 'read' ? readMessagingChannel : withMessagingContent)(
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

const deny = async (): Promise<never> => {
  throw createAppError('AUTHORIZATION');
};
/** Method selection cannot widen the canonical capability chosen for this tx. */
export function scopeFileFrame(
  frame: FileFrame,
  capability: 'post' | 'read',
): FileFrame {
  if (capability === 'post')
    return { ...frame, access: deny, listMessageFiles: deny };
  return {
    access: frame.access,
    listMessageFiles: frame.listMessageFiles,
    authorize: deny,
    reserve: deny,
    upload: deny,
    scan: deny,
    quarantine: deny,
    renew: deny,
    finalize: deny,
    cancel: deny,
  };
}
