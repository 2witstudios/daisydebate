import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLaunchControl } from './room-launch-control';
import type { App } from '../../src/server/app';
import { createMessagingPressure } from './messaging-pressure';
import { createMessagingPressureControl } from './messaging-pressure-control';
import { systemClock } from '@daisy/clock';
import { capacityRefusalFields } from '@daisy/db/capacity';
import { isAppError } from '@daisy/errors';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import type { IncomingMessage } from 'node:http';
import { STEP_LIMIT_MS } from './bounded-step';

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
  const pressure = createMessagingPressure(
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
    (expire) => {
      const timer = setTimeout(expire, STEP_LIMIT_MS);
      return () => clearTimeout(timer);
    },
  );
  const selectors = z
    .object({ channelId: idSchema, actorId: idSchema, userId: idSchema })
    .strict();
  const owner = createMessagingPressureControl(pressure);
  const prepare = (request: IncomingMessage, next: 'history' | 'entry') =>
    owner.prepare(next, async () => {
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
        if (Buffer.byteLength(body) > 512)
          throw new Error('Invalid pressure selectors');
      }
      return selectors.parse(JSON.parse(body));
    });
  database.messagingChannelStore = (authorize) => {
    const store = channelStore(authorize);
    return {
      ...store,
      readChannel: (scope, work) =>
        owner.mode() === 'history'
          ? pressure.target(() => store.readChannel(scope, work))
          : store.readChannel(scope, work),
    };
  };
  database.messagingChannelAuthority = (scope, work) =>
    owner.mode() === 'entry'
      ? pressure.target(() => authority(scope, work))
      : authority(scope, work);
  const control = await createLaunchControl({
    path: messagingRecoveryControlPath(port),
    settled: () => app.auth().settled(),
    pending: () => app.auth().pendingWork(),
    actions: {
      'refuse-messaging-history': (request) => prepare(request, 'history'),
      'refuse-messaging-entry': (request) => prepare(request, 'entry'),
      'allow-messaging-reads': owner.allow,
    },
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void owner.allow().then(
        () => control.close(),
        () => control.close(),
      );
      control.closeAllConnections();
    });
}
