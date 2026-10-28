import {
  createObservationSubscriber,
  dialObservationSubscriber,
  type SubscriberTransport,
} from '@daisy/redis';
import type { RealtimeApp } from '../app';
import type { RealtimeReadingPolicy } from '../authorization';
import type { IntervalTimers } from '../outbox-drain';
import { channelMessagesResource } from './channel-messages';
import { createFanout } from './fanout';
import { createObservationNode } from './node';
import { createObservationOwner } from './owner';
import { defineObservableResources } from './resources';

/** Owner reconciliation, Redis-only head repair, interest and permit renewal cadences (ADR 0089). */
export const OBSERVATION_CADENCE = {
  ownerMs: 100,
  repairMs: 500,
  interestMs: 2_000,
  renewMs: 1_000,
} as const;

/**
 * One realtime process's observation: its node always, its owner only when
 * the process is eligible (it then holds the headers and projection lanes),
 * one managed Pub/Sub subscriber connection, and the timers that drive them.
 * Every identity (node incarnation, claim token) is a fresh cuid2 per start.
 */
export function startObservationRuntime({
  resources,
  readingPolicy,
  timers,
  now,
  nextId,
  openSubscriber = dialObservationSubscriber(resources.config.REDIS_URL),
}: {
  readonly resources: RealtimeApp;
  readonly readingPolicy: RealtimeReadingPolicy;
  readonly timers: IntervalTimers;
  readonly now: () => number;
  readonly nextId: () => string;
  readonly openSubscriber?: () => SubscriberTransport;
}) {
  const report = (operation: string) =>
    resources.logger.log(
      'realtime.observation.unavailable',
      { operation, errorCode: 'INFRASTRUCTURE' },
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
      void node.repair().catch(() => report('observation.repair')),
    onLost: () => report('observation.subscriber'),
  });
  const node = createObservationNode({
    node: nextId(),
    now,
    resources: definitions,
    cache: resources.redis,
    subscriber,
    fanout: createFanout({ now }),
    onError: (operation) => report(operation),
  });
  const owner =
    resources.database.observation && resources.transport.observationOwner
      ? createObservationOwner({
          token: nextId(),
          candidateIncarnation: nextId(),
          now,
          resources: definitions,
          cache: resources.redis,
          onError: (operation) => report(operation),
        })
      : null;
  subscriber.start();
  const guarded = (work: () => Promise<void> | void, operation: string) => {
    let running = false;
    return () => {
      if (running) return;
      running = true;
      void Promise.resolve()
        .then(work)
        .catch(() => report(operation))
        .finally(() => {
          running = false;
        });
    };
  };
  const handles = [
    timers.setInterval(
      guarded(() => node.repair(), 'observation.repair'),
      OBSERVATION_CADENCE.repairMs,
    ),
    timers.setInterval(
      guarded(() => node.refreshInterest(), 'observation.interest'),
      OBSERVATION_CADENCE.interestMs,
    ),
    timers.setInterval(
      guarded(() => node.renew(), 'observation.renew'),
      OBSERVATION_CADENCE.renewMs,
    ),
    ...(owner
      ? [
          timers.setInterval(
            guarded(() => owner.tick(), 'observation.owner'),
            OBSERVATION_CADENCE.ownerMs,
          ),
        ]
      : []),
  ];
  return {
    node,
    close() {
      for (const handle of handles) timers.clearInterval(handle);
      owner?.close();
      node.close();
      subscriber.close();
    },
  };
}
export type ObservationRuntime = ReturnType<typeof startObservationRuntime>;
