import { instrumented } from '../instrumented';
import { outboxOperations, type OutboxPosition } from '../outbox';
import { readOutboxCatchup } from '../outbox-catchup';
import { readOutboxRetentionBoundary } from '../outbox-retention-boundary';
import type { WorkloadLane } from '../workload';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/**
 * The outbox's append, drain and retention on the control lane, and its
 * subscribe-time catch-up on `catchupLane` (control on web; admission on a
 * realtime process, so replays never take the drain's lane).
 */
export const createOutboxStore = (
  resources: DatabaseResources,
  { catchupLane = 'control' }: { readonly catchupLane?: WorkloadLane } = {},
) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  const catchup = lane(catchupLane).database;
  return namedLaneOperations({
    ...outboxOperations({ database: control, eventSink }),
    readOutboxRetentionBoundary: () =>
      instrumented(eventSink, 'readOutboxRetentionBoundary', () =>
        readOutboxRetentionBoundary(control),
      ),
    readOutboxCatchup: (
      topic: string,
      since: string,
      through: OutboxPosition,
      limit?: number,
    ) =>
      instrumented(eventSink, 'readOutboxCatchup', () =>
        readOutboxCatchup(catchup, topic, since, through, limit),
      ),
  });
};
export type OutboxStore = ReturnType<typeof createOutboxStore>;
