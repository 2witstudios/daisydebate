import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLaunchControl } from './room-launch-control';
import type { App } from '../../src/server/app';

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
  let holding = false;
  const behindReaders = async <T>(
    scope: Parameters<typeof authority>[0],
    run: () => Promise<T>,
  ): Promise<T> => {
    if (holding) return run();
    holding = true;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let readers = 0;
    const held = Promise.all(
      Array.from({ length: 4 }, () =>
        authority(scope, async () => {
          readers += 1;
          if (readers === 4) entered.resolve();
          await release.promise;
        }),
      ),
    );
    void held.catch(entered.reject);
    const outcome = await (async () => {
      try {
        await entered.promise;
        return { kind: 'ready' as const, value: await run() };
      } catch (error) {
        return { kind: 'failed' as const, error };
      } finally {
        release.resolve();
      }
    })();
    const cleanup = await held.then(
      () => ({ kind: 'ready' as const }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    );
    holding = false;
    if (cleanup.kind === 'failed')
      throw new AggregateError(
        outcome.kind === 'failed'
          ? [outcome.error, cleanup.error]
          : [cleanup.error],
        'Messaging admission proof cleanup failed',
      );
    if (outcome.kind === 'failed') throw outcome.error;
    return outcome.value;
  };
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
