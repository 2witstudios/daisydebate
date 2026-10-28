import type { ObservationResource } from '@daisy/protocol';
import { observationResourceKey } from '@daisy/protocol';
import {
  definitionFor,
  type ObservableResources,
  type ObservationHeader,
} from './resources';

/** The guarded Redis operations an owner uses (`@daisy/redis`). */
export type ObservationOwnerCache = {
  establishObservationIncarnation(candidate: string): Promise<string>;
  claimObservation(input: {
    readonly resource: ObservationResource;
    readonly incarnation: string;
    readonly token: string;
    readonly leaseMs: number;
  }): Promise<'owned' | 'taken' | 'idle'>;
  releaseObservation(
    resource: ObservationResource,
    token: string,
  ): Promise<boolean>;
  beginObservationBuild(input: {
    readonly resource: ObservationResource;
    readonly incarnation: string;
    readonly token: string;
  }): Promise<number | null>;
  publishObservation(input: {
    readonly base: {
      readonly resource: ObservationResource;
      readonly partition: string;
      readonly disclosureRevision: number;
    };
    readonly incarnation: string;
    readonly token: string;
    readonly purgeGeneration: number;
    readonly contentRevision: number;
    readonly body: string;
  }): Promise<'installed' | 'current' | 'refused'>;
  purgeObservation(resource: ObservationResource): Promise<number>;
  discoverObservationDemand(input: {
    readonly limit: number;
    readonly repairMs: number;
  }): Promise<readonly ObservationResource[]>;
};
export type ObservationOwnerBounds = {
  readonly owned: number;
  readonly discoverLimit: number;
  readonly leaseMs: number;
  readonly builds: number;
  /** A cached body is rebuilt at least this often so its 60s TTL never lapses under interest. */
  readonly refreshMs: number;
};
const defaultObservationOwnerBounds: ObservationOwnerBounds = {
  owned: 1_024,
  discoverLimit: 32,
  leaseMs: 2_000,
  builds: 2,
  refreshMs: 30_000,
};
type Owned = {
  readonly resource: ObservationResource;
  built: ObservationHeader | null;
  builtAt: number;
  building: boolean;
};

/**
 * The reconciliation owner hosted by an eligible realtime process (ADR
 * 0089). One tick (every 100ms) claims due demand, reads the headers of
 * every owned resource in one batched query per kind, and builds a newer
 * snapshot once for the fleet. Ownership renews only after a successful
 * header read, so a hung database cannot pin it; it is a reader and
 * projector only, and no command depends on it.
 */
export function createObservationOwner({
  token,
  candidateIncarnation,
  now,
  resources: definitions,
  cache,
  bounds = defaultObservationOwnerBounds,
  onError = () => {},
}: {
  /** This process's unguessable claim token (cuid2 from the OS CSPRNG). */
  readonly token: string;
  /** Installed as the cache incarnation when none exists. */
  readonly candidateIncarnation: string;
  readonly now: () => number;
  readonly resources: ObservableResources;
  readonly cache: ObservationOwnerCache;
  readonly bounds?: ObservationOwnerBounds;
  readonly onError?: (operation: string, error: unknown) => void;
}) {
  const owned = new Map<string, Owned>();
  let incarnation: string | null = null;
  let building = 0;
  let closed = false;

  function drop(key: string) {
    const entry = owned.get(key);
    if (!entry) return;
    owned.delete(key);
    void cache
      .releaseObservation(entry.resource, token)
      .catch((error) => onError('observation.release', error));
  }

  async function build(entry: Owned, at: string) {
    const definition = definitionFor(definitions, entry.resource);
    if (!definition || incarnation === null) return;
    entry.building = true;
    building++;
    try {
      const purgeGeneration = await cache.beginObservationBuild({
        resource: entry.resource,
        incarnation: at,
        token,
      });
      if (
        purgeGeneration === null ||
        owned.get(observationResourceKey(entry.resource)) !== entry
      ) {
        drop(observationResourceKey(entry.resource));
        return;
      }
      const projection = await definition.project(entry.resource.id);
      if (closed || incarnation !== at) return;
      if (projection === null) {
        await cache.purgeObservation(entry.resource);
        drop(observationResourceKey(entry.resource));
        return;
      }
      const result = await cache.publishObservation({
        base: {
          resource: entry.resource,
          partition: projection.partition,
          disclosureRevision: projection.disclosureRevision,
        },
        incarnation: at,
        token,
        purgeGeneration,
        contentRevision: projection.contentRevision,
        body: JSON.stringify(projection.body),
      });
      if (result !== 'refused') {
        entry.built = {
          contentRevision: projection.contentRevision,
          disclosureRevision: projection.disclosureRevision,
        };
        entry.builtAt = now();
      }
    } catch (error) {
      onError('observation.build', error);
    } finally {
      entry.building = false;
      building--;
    }
  }

  async function reconcile(at: string) {
    const byKind = new Map<string, Owned[]>();
    for (const entry of owned.values()) {
      const list = byKind.get(entry.resource.kind) ?? [];
      list.push(entry);
      byKind.set(entry.resource.kind, list);
    }
    for (const [, entries] of byKind) {
      const definition = definitionFor(definitions, entries[0]!.resource);
      if (!definition) continue;
      let headers: ReadonlyMap<string, ObservationHeader>;
      try {
        headers = await definition.readHeaders(
          entries.map((e) => e.resource.id),
        );
      } catch (error) {
        // No progress, no renewal: the lease lapses and a successor may take over.
        onError('observation.headers', error);
        continue;
      }
      if (closed || incarnation !== at) return;
      for (const entry of entries) {
        const key = observationResourceKey(entry.resource);
        const claim = await cache
          .claimObservation({
            resource: entry.resource,
            incarnation: at,
            token,
            leaseMs: bounds.leaseMs,
          })
          .catch((error) => {
            onError('observation.claim', error);
            return 'taken' as const;
          });
        if (claim !== 'owned') {
          drop(key);
          continue;
        }
        const header = headers.get(entry.resource.id);
        if (!header) {
          // Deleted: purge its bodies and stop owning it.
          await cache
            .purgeObservation(entry.resource)
            .catch((error) => onError('observation.purge', error));
          drop(key);
          continue;
        }
        const newer =
          entry.built === null ||
          header.disclosureRevision > entry.built.disclosureRevision ||
          header.contentRevision > entry.built.contentRevision ||
          now() - entry.builtAt >= bounds.refreshMs;
        if (newer && !entry.building && building < bounds.builds)
          void build(entry, at);
      }
    }
  }

  let ticks = 0;
  return {
    async tick() {
      if (closed) return;
      try {
        const at =
          await cache.establishObservationIncarnation(candidateIncarnation);
        if (at !== incarnation) {
          // A reset voids every guard: start over from fresh claims and reads.
          owned.clear();
          incarnation = at;
        }
        if (ticks++ % 5 === 0 && owned.size < bounds.owned) {
          const due = await cache.discoverObservationDemand({
            limit: bounds.discoverLimit,
            repairMs: 500,
          });
          for (const resource of due) {
            const key = observationResourceKey(resource);
            if (owned.has(key) || owned.size >= bounds.owned) continue;
            if (!definitionFor(definitions, resource)) continue;
            const claim = await cache.claimObservation({
              resource,
              incarnation: at,
              token,
              leaseMs: bounds.leaseMs,
            });
            if (claim === 'owned')
              owned.set(key, {
                resource,
                built: null,
                builtAt: 0,
                building: false,
              });
          }
        }
        await reconcile(at);
      } catch (error) {
        onError('observation.owner', error);
      }
    },
    close() {
      closed = true;
      for (const key of [...owned.keys()]) drop(key);
    },
    stats: () => ({ owned: owned.size, building }),
  };
}
