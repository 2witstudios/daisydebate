import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLaunchControl } from './room-launch-control';
import type { App } from '../../src/server/app';
import { createMessagingPressure } from './messaging-pressure';
import { systemClock } from '@daisy/clock';
import { capacityRefusalFields } from '@daisy/db/capacity';
import { isAppError } from '@daisy/errors';

export const messagingRecoveryControlPath = (port: number) =>
  join(tmpdir(), `dmr-${port}.sock`);

/**
 * Hold four real shared-authority transactions in this web process's actual
 * social lane. The target then queues on its unchanged 4/16/100 gate; nothing
 * substitutes a response, gate, policy, database or authorization decision.
 */
export async function createMessagingRecoveryControl(app: App, port: number) {
  const database = app.database;
  const authority = database.messagingChannelAuthority.bind(database);
  const channelStore = database.messagingChannelStore.bind(database);
  let target: 'history' | 'entry' | null = null;
  const behindReaders = createMessagingPressure(
    (scope: Parameters<typeof authority>[0], work) => authority(scope, work),
    (sample, errors) =>
      process.stdout.write(
        JSON.stringify({
          event: 'e2e.messaging.pressure',
          time: Date.parse(systemClock.now()),
          ...sample,
          causes: errors.map((error) => {
            const cause = capacityRefusalFields(error)?.cause;
            return cause === 'social.expired' || cause === 'social.saturated'
              ? cause
              : isAppError(error)
                ? error.code
                : 'INTERNAL';
          }),
        }) + '\n',
      ),
  );
  database.messagingChannelStore = (authorize) => {
    const store = channelStore(authorize);
    return {
      ...store,
      readChannel: (scope, work) =>
        target === 'history'
          ? behindReaders(scope, () => store.readChannel(scope, work))
          : store.readChannel(scope, work),
    };
  };
  database.messagingChannelAuthority = (scope, work) =>
    target === 'entry'
      ? behindReaders(scope, () => authority(scope, work))
      : authority(scope, work);
  const control = await createLaunchControl({
    path: messagingRecoveryControlPath(port),
    settled: () => app.auth().settled(),
    pending: () => app.auth().pendingWork(),
    actions: {
      'refuse-messaging-history': async () => {
        target = 'history';
      },
      'refuse-messaging-entry': async () => {
        target = 'entry';
      },
      'allow-messaging-reads': async () => {
        target = null;
      },
    },
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      control.close();
      control.closeAllConnections();
    });
}
