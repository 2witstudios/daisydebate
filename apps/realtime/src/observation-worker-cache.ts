import type {
  ObservationBase,
  ObservationHeader,
  ObservationResource,
} from '@daisy/protocol';
import type { RealtimeApp } from './app';

const bodyTtlMs = 60_000,
  claimTtlMs = 2000;
/** Worker cache port over guarded Redis publication in the current cache
 * incarnation; an unknown incarnation refuses rather than guessing. */
export function workerCache(
  redis: RealtimeApp['redis'],
  incarnation: () => string | null,
) {
  const current = () => {
    const value = incarnation();
    if (value === null)
      throw new Error('Observation cache incarnation unknown');
    return value;
  };
  return {
    claim: (resource: ObservationResource, token: string) =>
      redis.claimObservation({
        resource,
        incarnation: current(),
        token,
        ttlMs: claimTtlMs,
      }),
    release: async (resource: ObservationResource, token: string) => {
      await redis.releaseObservation(resource, token);
    },
    prepare: (header: ObservationHeader, token: string) =>
      redis.prepareObservation({
        resource: header.resource,
        incarnation: current(),
        token,
        purgeGeneration: header.purgeGeneration,
        disclosureRevision: header.disclosureRevision,
      }),
    ready: (base: ObservationBase, header: ObservationHeader, token: string) =>
      redis.retainObservation({
        resource: header.resource,
        incarnation: current(),
        token,
        base,
        purgeGeneration: header.purgeGeneration,
        contentRevision: header.contentRevision,
        ttlMs: bodyTtlMs,
      }),
    publish: async (
      snapshot: { readonly header: ObservationHeader; readonly body: string },
      base: ObservationBase,
      token: string,
    ) =>
      (await redis.publishObservation({
        resource: snapshot.header.resource,
        incarnation: current(),
        token,
        purgeGeneration: snapshot.header.purgeGeneration,
        base,
        contentRevision: snapshot.header.contentRevision,
        body: snapshot.body,
        ttlMs: bodyTtlMs,
      })) === 1,
  };
}
