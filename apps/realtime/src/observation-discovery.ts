import {
  observationResourceKey,
  observationResourceSchema,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';

/** Tracked resources plus valid newly discovered keys, within the owner cap. */
function discovered(
  tracked: ReadonlyMap<string, ObservationResource>,
  found: readonly string[],
  capacity: number,
) {
  if (found.length > capacity)
    throw new Error('Invalid observation discovery capacity');
  const resources = new Map(tracked);
  for (const key of found) {
    const separator = key.indexOf('-');
    const resource = observationResourceSchema.parse({
      kind: key.slice(0, separator),
      id: key.slice(separator + 1),
    });
    if (observationResourceKey(resource) !== key)
      throw new Error('Invalid observation discovery key');
    if (resources.size < 64 || resources.has(key)) resources.set(key, resource);
  }
  return resources;
}
/** Redis demand is resource-scoped. Fanout replicas never discover SQL work. */
export function createObservationDiscovery({
  eligible,
  cache,
  worker,
}: {
  readonly eligible: boolean;
  readonly cache: {
    readonly discover: (limit: number) => Promise<readonly string[]>;
    readonly readDemand: (
      resource: ObservationResource,
    ) => Promise<readonly ObservationBase[]>;
  };
  readonly worker: {
    readonly replaceDemand: (
      resource: ObservationResource,
      bases: readonly ObservationBase[],
    ) => Promise<boolean>;
    readonly uncertain: () => void;
  };
}) {
  const tracked = new Map<string, ObservationResource>();
  const discover = async (capacity: number) =>
    capacity > 0 ? cache.discover(capacity) : [];
  let closed = false,
    running = false,
    generation = 0;
  return {
    async reconcile() {
      if (!eligible || closed || running) return;
      running = true;
      const attempt = generation;
      const stale = () => closed || attempt !== generation;
      try {
        const capacity = 64 - tracked.size;
        const found = await discover(capacity);
        if (stale()) return;
        for (const [key, resource] of discovered(tracked, found, capacity)) {
          const bases = await cache.readDemand(resource);
          if (stale()) return;
          const owned = await worker.replaceDemand(resource, bases);
          if (stale()) return;
          if (owned) tracked.set(key, resource);
          else tracked.delete(key);
        }
      } catch (error) {
        generation++;
        tracked.clear();
        worker.uncertain();
        throw error;
      } finally {
        running = false;
      }
    },
    uncertain() {
      generation++;
      tracked.clear();
      worker.uncertain();
    },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      tracked.clear();
      worker.uncertain();
    },
  };
}
