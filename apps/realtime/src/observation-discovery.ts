import {
  observationResourceKey,
  observationResourceSchema,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';

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
  let closed = false,
    running = false,
    generation = 0;
  return {
    async reconcile() {
      if (!eligible || closed || running) return;
      running = true;
      const attempt = generation;
      try {
        const capacity = 64 - tracked.size;
        const found = capacity > 0 ? await cache.discover(capacity) : [];
        if (closed || attempt !== generation) return;
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
          if (resources.size < 64 || resources.has(key))
            resources.set(key, resource);
        }
        for (const [key, resource] of resources) {
          const bases = await cache.readDemand(resource);
          if (closed || attempt !== generation) return;
          const owned = await worker.replaceDemand(resource, bases);
          if (closed || attempt !== generation) return;
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
