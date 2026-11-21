import { tryInstantMs } from '@daisy/clock';
import type { EntitlementGrant } from '@daisy/protocol';

export type EntitlementEvaluation = {
  readonly now: string;
  readonly betaGrantsPremium: boolean;
};

function intervalCovers(now: number, startsAt: string, expiresAt: string) {
  const start = tryInstantMs(startsAt);
  const end = tryInstantMs(expiresAt);
  return start !== undefined && end !== undefined && start <= now && now < end;
}

/** A worker cannot prolong access by failing to remove an expired row. */
export function currentEntitlementGrants(
  grants: readonly EntitlementGrant[],
  evaluation: EntitlementEvaluation,
): readonly EntitlementGrant[] {
  const now = tryInstantMs(evaluation.now);
  if (now === undefined) return [];
  return grants.filter((grant) => {
    if (grant.entitlement === 'tournament_hosting') {
      return (
        grant.source === grant.hosting.issuer.kind &&
        intervalCovers(now, grant.hosting.startsAt, grant.hosting.expiresAt)
      );
    }
    switch (grant.source) {
      case 'beta':
        return evaluation.betaGrantsPremium;
      case 'subscription':
      case 'organization_seat':
        return intervalCovers(now, grant.startsAt, grant.expiresAt);
    }
  });
}
