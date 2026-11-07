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
  const now = Date.parse(evaluation.now);
  if (!Number.isFinite(now)) return [];
  return grants.filter((grant) => {
    switch (grant.source) {
      case 'beta':
        return evaluation.betaGrantsPremium;
      case 'subscription': {
        const start = Date.parse(grant.startsAt);
        const end = Date.parse(grant.expiresAt);
        return start <= now && now < end;
      }
    }
  });
}
