import { instantMs, tryInstantMs } from '@daisy/clock';
import type { EntitlementGrant } from '@daisy/protocol';

export type EntitlementEvaluation = {
  readonly now: string;
  readonly betaGrantsPremium: boolean;
};

/** A worker cannot prolong access by failing to remove an expired row. */
export function currentEntitlementGrants(
  grants: readonly EntitlementGrant[],
  evaluation: EntitlementEvaluation,
): readonly EntitlementGrant[] {
  const now = tryInstantMs(evaluation.now);
  if (now === undefined) return [];
  return grants.filter((grant) => {
    if (grant.entitlement === 'tournament_hosting') {
      const start = instantMs(grant.hosting.startsAt);
      const end = instantMs(grant.hosting.expiresAt);
      return (
        grant.source === grant.hosting.issuer.kind && start <= now && now < end
      );
    }
    switch (grant.source) {
      case 'beta':
        return evaluation.betaGrantsPremium;
      case 'subscription':
      case 'organization_seat': {
        const start = instantMs(grant.startsAt);
        const end = instantMs(grant.expiresAt);
        return start <= now && now < end;
      }
    }
  });
}
