import { currentEntitlementGrants } from '@daisy/auth/authorization';
import type { EntitlementGrant } from '@daisy/protocol/entitlements';

/**
 * Whether a member wears the Premium mark (ADR 0933): they currently hold a
 * Premium entitlement, by the same validity rule that gives access. Hosting
 * events is its own product and earns no mark.
 */
export const wearsPremiumMark = (
  grants: readonly EntitlementGrant[],
  evaluation: Parameters<typeof currentEntitlementGrants>[1],
): boolean =>
  currentEntitlementGrants(grants, evaluation).some(
    (grant) => grant.entitlement !== 'tournament_hosting',
  );
