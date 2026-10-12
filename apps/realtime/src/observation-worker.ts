import {
  observationBaseKey,
  observationResourceKey,
  type ObservationBase,
  type ObservationHeader,
  type ObservationResource,
} from '@daisy/protocol';
type Snapshot = { readonly header: ObservationHeader; readonly body: string };
type Owner = {
  readonly resource: ObservationResource;
  readonly token: string;
  readonly generation: number;
  expiresAt: number;
  readonly variants: Map<string, ObservationBase>;
  readonly delivered: Map<string, number>;
  readonly dirtySince: Map<string, number>;
};
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
  readonly cache: {
    readonly ready: (
      base: ObservationBase,
      header: ObservationHeader,
    ) => Promise<boolean>;
    readonly claim: (
      resource: ObservationResource,
      token: string,
    ) => Promise<boolean>;
    readonly prepare: (
      header: ObservationHeader,
      token: string,
    ) => Promise<boolean>;
    readonly publish: (
      snapshot: Snapshot,
      base: ObservationBase,
      token: string,
    ) => Promise<boolean>;
    readonly release: (
      resource: ObservationResource,
      token: string,
    ) => Promise<void>;
  };
  readonly readHeaders: (
    resources: readonly ObservationResource[],
  ) => Promise<readonly ObservationHeader[]>;
  readonly build: (
    base: ObservationBase,
    header: ObservationHeader,
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
    if (jobs.has(key) || jobs.size >= 2 || !current(owner)) return;
    const work = (async () => {
      const snapshot = await build(base, header);
      if (
        !current(owner) ||
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
  return {
    demand(base: ObservationBase) {
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
    },
    async reconcile() {
      if (!eligible || closed || reconciling) return;
      reconciling = true;
      try {
        const active: Owner[] = [];
        for (const owner of owners.values()) {
          if (owner.expiresAt !== 0 && !current(owner)) {
            owners.delete(observationResourceKey(owner.resource));
            continue;
          }
          if (owner.expiresAt === 0) {
            if (!(await cache.claim(owner.resource, owner.token))) continue;
            owner.expiresAt = now() + 2000;
          }
          if (current(owner)) active.push(owner);
        }
        if (!active.length) return;
        const headers = await readHeaders(
          active.map((owner) => owner.resource),
        );
        for (const header of headers) {
          const owner = owners.get(observationResourceKey(header.resource));
          if (!owner || !current(owner)) continue;
          if (
            [...owner.dirtySince.values()].some(
              (started) => now() - started >= 2000,
            )
          )
            continue;
          if (!(await cache.prepare(header, owner.token)) || !current(owner)) {
            if (owners.get(observationResourceKey(owner.resource)) === owner)
              owners.delete(observationResourceKey(owner.resource));
            continue;
          }
          // A successful current-state read is useful progress; heartbeat alone is not.
          if (
            !(await cache.claim(owner.resource, owner.token)) ||
            !current(owner)
          ) {
            if (owners.get(observationResourceKey(owner.resource)) === owner)
              owners.delete(observationResourceKey(owner.resource));
            continue;
          }
          owner.expiresAt = now() + 2000;
          for (const [key, base] of owner.variants) {
            if (base.disclosureRevision !== header.disclosureRevision) continue;
            if (!(await cache.ready(base, header))) owner.delivered.delete(key);
            if (!current(owner)) break;
            if ((owner.delivered.get(key) ?? -1) >= header.contentRevision)
              continue;
            if (!owner.dirtySince.has(key)) owner.dirtySince.set(key, now());
            start(owner, base, header);
          }
        }
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
