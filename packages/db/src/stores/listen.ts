import { subscribeOutbox, type OutboxListenHandlers } from '../listen';
import {
  subscribeRealtimeHints,
  type RealtimeHintHandlers,
} from '../realtime-hints';
import { subscribeWorkWakes, type WorkWakeHandlers } from '../work-wake';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/**
 * The process's LISTEN subscriptions on its dedicated connections, outside
 * every lane and never handed out (ADR 0032 §2, §3; ADR 0154).
 */
export const createListenStore = (resources: DatabaseResources) => {
  const { dedicated } = resourcesOf(resources);
  return namedLaneOperations({
    /** The RT-2.3b drain loop's durable outbox subscription. */
    listenOutbox: (handlers: OutboxListenHandlers) =>
      subscribeOutbox(dedicated, handlers),
    /** Validated transient hints; the durable drain is independent. */
    listenRealtimeHints: (handlers: RealtimeHintHandlers) =>
      subscribeRealtimeHints(dedicated, handlers),
    /** Lossy worker wakes. */
    listenWorkWakes: (handlers: WorkWakeHandlers) =>
      subscribeWorkWakes(dedicated, handlers),
  });
};
export type { WorkKind } from '../work-wake';
