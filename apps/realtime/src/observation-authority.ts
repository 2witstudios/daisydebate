import type {
  ObservationAuthorityResult,
  ObservationBinding,
} from '@daisy/db/observation';
import {
  observationEvidence,
  type ObservationGrant,
} from './observation-permit';

type AuthorityRead = (
  bindings: readonly ObservationBinding[],
) => Promise<readonly ObservationAuthorityResult[]>;
export type ObservationAuthorityReadResult =
  | {
      readonly status: 'allowed';
      readonly grant: ObservationGrant;
      readonly overlay: unknown;
    }
  | { readonly status: 'denied' | 'unavailable' };

/** The original start precedes all owning executor/driver/lock waits. */
export function createObservationAuthorityReader({
  now,
  operations,
}: {
  readonly now: () => number;
  readonly operations: {
    readonly admitObservationAuthorityBatch: AuthorityRead;
    readonly renewObservationAuthorityBatch: AuthorityRead;
  };
}) {
  async function read(
    operation: AuthorityRead,
    bindings: readonly ObservationBinding[],
  ): Promise<readonly ObservationAuthorityReadResult[]> {
    const started = now();
    try {
      const results = await operation(bindings);
      const finished = now();
      if (
        !Number.isFinite(started) ||
        !Number.isFinite(finished) ||
        finished < started ||
        results.length !== bindings.length
      )
        throw new Error('Unavailable observation clock or batch');
      return results.map((result) => {
        if (result.status !== 'allowed') return result;
        try {
          const grant: ObservationGrant = {
            base: result.base,
            minimumContentRevision: result.minimumContentRevision,
            purgeGeneration: result.purgeGeneration,
            subject: observationEvidence({ started, ...result.subject }),
            cohort: observationEvidence({ started, ...result.cohort }),
            entitlement: observationEvidence({
              started,
              ...result.entitlement,
            }),
          };
          if (
            [grant.subject, grant.cohort, grant.entitlement].some(
              (part) => finished >= part.expiresAt,
            )
          )
            return { status: 'unavailable' } as const;
          return { status: 'allowed', grant, overlay: result.overlay } as const;
        } catch {
          return { status: 'unavailable' } as const;
        }
      });
    } catch {
      return bindings.map(() => ({ status: 'unavailable' }) as const);
    }
  }
  return {
    admit: (bindings: readonly ObservationBinding[]) =>
      read(operations.admitObservationAuthorityBatch, bindings),
    renew: (bindings: readonly ObservationBinding[]) =>
      read(operations.renewObservationAuthorityBatch, bindings),
  };
}
