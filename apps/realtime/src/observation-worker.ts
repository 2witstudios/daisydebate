import {
  observationBaseKey,
  observationResourceKey,
  type ObservationBase,
  type ObservationHeader,
  type ObservationResource,
} from '@daisy/protocol';
import type { ObservationWorkerCache } from './observation-worker-cache';
export type ObservationSnapshotBuild = {
  readonly header: ObservationHeader;
  readonly body: string;
};
type Snapshot = ObservationSnapshotBuild;
type Owner = {
  readonly resource: ObservationResource;
  readonly token: string;
  readonly generation: number;
  expiresAt: number;
  readonly variants: Map<string, ObservationBase>;
  readonly delivered: Map<string, number>;
  readonly dirtySince: Map<string, number>;
};
function validDemand(
  resource: ObservationResource,
  bases: readonly ObservationBase[],
) {
  const resourceKey = observationResourceKey(resource);
  if (
    bases.length > 64 ||
    bases.some((base) => observationResourceKey(base.resource) !== resourceKey)
  )
    throw new Error('Invalid observation resource demand');
  return resourceKey;
}
/** Resource-scoped reader ownership; only the eligible allocation owns SQL.
 * Jobs occupy their actual slot until settlement, including expired ownership.
 */
export function createObservationWorker({
  eligible,
  now,
  nextToken,
  cache,
  readHeaders,
  build,
}: {
  readonly eligible: boolean;
  readonly now: () => number;
  readonly nextToken: () => string;
  readonly cache: ObservationWorkerCache;
  /** `isCurrent` is rechecked by the executor after every wait. */
  readonly readHeaders: (
    resources: readonly ObservationResource[],
    isCurrent: () => boolean,
  ) => Promise<readonly ObservationHeader[]>;
  readonly build: (
    base: ObservationBase,
    header: ObservationHeader,
    isCurrent: () => boolean,
  ) => Promise<Snapshot>;
}) {
  const owners = new Map<string, Owner>();
  const jobs = new Map<string, Promise<void>>();
  let generation = 0,
    closed = false,
    reconciling = false;
  const current = (owner: Owner) =>
    !closed &&
    owner.generation === generation &&
    owners.get(observationResourceKey(owner.resource)) === owner &&
    now() < owner.expiresAt;
  function start(
    owner: Owner,
    base: ObservationBase,
    header: ObservationHeader,
  ) {
    const key = observationBaseKey(base);
    if (
      jobs.has(key) ||
      jobs.size >= 2 ||
      !current(owner) ||
      !owner.variants.has(key)
    )
      return;
    const work = (async () => {
      const snapshot = await build(
        base,
        header,
        () => current(owner) && owner.variants.has(key),
      );
      if (
        !current(owner) ||
        !owner.variants.has(key) ||
        snapshot.header.disclosureRevision !== base.disclosureRevision ||
        snapshot.header.purgeGeneration !== header.purgeGeneration
      )
        return;
      // Trailing dirt cannot suppress a coherent completed newer version.
      if (
        snapshot.header.contentRevision > (owner.delivered.get(key) ?? -1) &&
        (await cache.publish(snapshot, base, owner.token))
      ) {
        if (!current(owner)) return;
        owner.delivered.set(key, snapshot.header.contentRevision);
        owner.dirtySince.delete(key);
      }
    })()
      .catch(() => {
        /* A later bounded reconciliation retries without another event. */
      })
      .finally(() => {
        jobs.delete(key);
      });
    jobs.set(key, work);
  }
  async function apply(
    captured: Map<string, Owner>,
    headers: readonly ObservationHeader[],
  ) {
    for (const header of headers) {
      const key = observationResourceKey(header.resource);
      const owner = captured.get(key);
      captured.delete(key);
      if (owner && current(owner) && !stuck(owner))
        await progress(owner, header);
    }
    // A header follows its resource: absence is deletion, never "unchanged".
    for (const owner of captured.values()) await deleted(owner);
  }
  async function deleted(owner: Owner) {
    if (!current(owner)) return;
    forget(owner);
    await cache.drop(owner.resource, owner.token);
  }
  function forget(owner: Owner) {
    const key = observationResourceKey(owner.resource);
    if (owners.get(key) === owner) owners.delete(key);
  }
  function retainVariants(owner: Owner, bases: readonly ObservationBase[]) {
    const active = new Set(bases.map(observationBaseKey));
    for (const key of owner.variants.keys())
      if (!active.has(key)) {
        owner.variants.delete(key);
        owner.delivered.delete(key);
        owner.dirtySince.delete(key);
      }
  }
  /** Lease lifetime starts before the claim await, never on response arrival. */
  async function claim(owner: Owner) {
    const started = now();
    if (!(await cache.claim(owner.resource, owner.token))) return false;
    owner.expiresAt = started + 2000;
    return true;
  }
  async function claimed() {
    const active: Owner[] = [];
    for (const owner of owners.values()) {
      if (owner.expiresAt !== 0 && !current(owner)) {
        owners.delete(observationResourceKey(owner.resource));
        continue;
      }
      if (owner.expiresAt === 0 && !(await claim(owner))) continue;
      if (current(owner)) active.push(owner);
    }
    return active;
  }
  const stuck = (owner: Owner) =>
    [...owner.dirtySince.values()].some((started) => now() - started >= 2000);
  /** A successful current-state read is useful progress; heartbeat alone is not. */
  async function progress(owner: Owner, header: ObservationHeader) {
    if (!(await cache.prepare(header, owner.token)) || !current(owner)) {
      forget(owner);
      return;
    }
    if (!(await claim(owner)) || !current(owner)) {
      forget(owner);
      return;
    }
    await schedule(owner, header);
  }
  async function schedule(owner: Owner, header: ObservationHeader) {
    for (const [key, base] of owner.variants) {
      if (base.disclosureRevision !== header.disclosureRevision) continue;
      if (!(await cache.ready(base, header, owner.token)))
        owner.delivered.delete(key);
      if (!current(owner)) break;
      if ((owner.delivered.get(key) ?? -1) >= header.contentRevision) continue;
      if (!owner.dirtySince.has(key)) owner.dirtySince.set(key, now());
      start(owner, base, header);
    }
  }
  function demand(base: ObservationBase) {
    if (closed) throw new Error('Observation worker disposed');
    const key = observationResourceKey(base.resource);
    let owner = owners.get(key);
    if (!owner) {
      if (owners.size >= 64)
        throw new Error('Observation owner capacity exceeded');
      owner = {
        resource: base.resource,
        token: nextToken(),
        generation,
        expiresAt: 0,
        variants: new Map(),
        delivered: new Map(),
        dirtySince: new Map(),
      };
      owners.set(key, owner);
    }
    if (
      !owner.variants.has(observationBaseKey(base)) &&
      owner.variants.size >= 64
    )
      throw new Error('Observation variant capacity exceeded');
    owner.variants.set(observationBaseKey(base), base);
  }
  return {
    demand,
    async replaceDemand(
      resource: ObservationResource,
      bases: readonly ObservationBase[],
    ) {
      if (closed) throw new Error('Observation worker disposed');
      if (!eligible) return false;
      const resourceKey = validDemand(resource, bases);
      const owner = owners.get(resourceKey);
      if (!bases.length) {
        if (owner) {
          owners.delete(resourceKey);
          await cache.release(resource, owner.token);
        }
        return false;
      }
      if (owner) retainVariants(owner, bases);
      for (const base of bases) demand(base);
      const selected = owners.get(resourceKey)!;
      if (selected.expiresAt === 0 && !(await claim(selected))) {
        forget(selected);
        return false;
      }
      if (!current(selected)) {
        forget(selected);
        return false;
      }
      return true;
    },
    async reconcile() {
      if (!eligible || closed || reconciling) return;
      reconciling = true;
      try {
        const currentBatch = (await claimed()).filter(current);
        if (!currentBatch.length) return;
        const captured = new Map(
          currentBatch.map((owner) => [
            observationResourceKey(owner.resource),
            owner,
          ]),
        );
        const headers = await readHeaders(
          currentBatch.map((owner) => owner.resource),
          () => currentBatch.some(current),
        );
        await apply(captured, headers);
      } catch (error) {
        generation++;
        owners.clear();
        throw error;
      } finally {
        reconciling = false;
      }
    },
    uncertain() {
      generation++;
      owners.clear();
    },
    settled: async () => {
      await Promise.allSettled([...jobs.values()]);
    },
    async close() {
      if (closed) return;
      closed = true;
      generation++;
      const release = [...owners.values()];
      owners.clear();
      for (const owner of release)
        await cache.release(owner.resource, owner.token);
      await Promise.allSettled([...jobs.values()]);
    },
  };
}
