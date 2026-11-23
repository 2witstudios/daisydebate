import {
  createObservationSubscriber,
  dialObservationSubscriber,
  type SubscriberTransport,
} from '@daisy/redis';
import type { Waits } from '@daisy/clock';
import { errorCodeOf } from '@daisy/errors';
import { repeatEvery } from '@daisy/worker';
import type { RealtimeApp } from '../app';
import type { RealtimeReadingPolicy } from '../authorization';
import { channelMessagesResource } from './channel-messages';
import { createFanout } from './fanout';
import { createObservationNode } from './node';
import { createObservationOwner } from './owner';
import { defineObservableResources } from './resources';

/** Owner reconciliation, Redis-only head repair, interest and permit renewal cadences (ADR 0089). */
const OBSERVATION_CADENCE = {
  ownerMs: 100,
  repairMs: 500,
  interestMs: 2_000,
  renewMs: 1_000,
} as const;

/**
 * One realtime process's observation: its node always, its owner only when
 * the process is eligible (it then holds the headers and projection lanes),
 * one managed Pub/Sub subscriber connection, and the cadences that drive them.
 * Every identity (node incarnation, claim token) is a fresh cuid2 per start.
 */
export function startObservationRuntime({
  resources,
  readingPolicy,
  waits,
  now,
  nextId,
  openSubscriber = dialObservationSubscriber(resources.config.REDIS_URL),
}: {
  readonly resources: RealtimeApp;
  readonly readingPolicy: RealtimeReadingPolicy;
  readonly waits: Waits;
  readonly now: () => number;
  readonly nextId: () => string;
  readonly openSubscriber?: () => SubscriberTransport;
}) {
  // The code only, never the raw error (ADR 0037); unknown faults are outages.
  const report = (operation: string, error?: unknown) =>
    resources.logger.log(
      'realtime.observation.unavailable',
      {
        operation,
        errorCode: errorCodeOf(error, 'INFRASTRUCTURE'),
      },
      'Observation work unavailable',
    );
  const definitions = defineObservableResources([
    channelMessagesResource({
      owner: resources.database.observation,
      authority: {
        admission: resources.database.admission,
        renewal: resources.database.renewal,
      },
      clock: resources.clock,
      now,
      readingPolicy,
    }),
  ]);
  const subscriber = createObservationSubscriber({
    namespace: resources.config.REDIS_NAMESPACE,
    open: openSubscriber,
    onHint: (resource, hint) => node.hint(resource, hint),
    onSynchronized: () =>
      void node.repair().catch((error) => report('observation.repair', error)),
    onLost: () => report('observation.subscriber'),
    waits,
  });
  const node = createObservationNode({
    node: nextId(),
    now,
    resources: definitions,
    cache: resources.redis,
    subscriber,
    fanout: createFanout({ now }),
    onError: (operation, error) => report(operation, error),
  });
  const owner =
    resources.database.observation && resources.transport.observationOwner
      ? createObservationOwner({
          token: nextId(),
          candidateIncarnation: nextId(),
          now,
          resources: definitions,
          cache: resources.redis,
          onError: (operation, error) => report(operation, error),
        })
      : null;
  subscriber.start();
  // Each cadence runs one pass at a time; a pass due while one runs is skipped.
  const every = (
    everyMs: number,
    work: () => Promise<void> | void,
    operation: string,
  ) =>
    repeatEvery({
      waits,
      everyMs,
      run: async () => work(),
      failed: (error) => report(operation, error),
    });
  const cadences = [
    every(
      OBSERVATION_CADENCE.repairMs,
      () => node.repair(),
      'observation.repair',
    ),
    every(
      OBSERVATION_CADENCE.interestMs,
      () => node.refreshInterest(),
      'observation.interest',
    ),
    every(OBSERVATION_CADENCE.renewMs, () => node.renew(), 'observation.renew'),
    ...(owner
      ? [
          every(
            OBSERVATION_CADENCE.ownerMs,
            () => owner.tick(),
            'observation.owner',
          ),
        ]
      : []),
  ];
  return {
    node,
    /**
     * Stops every cadence and closes the owner, node and subscriber at once,
     * so a pass still in flight finds them closed; resolves once those
     * passes have ended.
     */
    async close() {
      const stopping = cadences.map((cadence) => cadence.stop());
      owner?.close();
      node.close();
      subscriber.close();
      await Promise.all(stopping);
    },
  };
}
