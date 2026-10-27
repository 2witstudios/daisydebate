import type { EntitlementGrant } from '@daisy/protocol';
import type { AccountAuthorizationFact } from './authorization-facts';

/**
 * DEC-247 and ISSUE-779: premium entitlements come from the account's own
 * grant facts, never from its beta state. Beta approval is one source of a
 * grant; `betaGrantsPremium` says whether a beta-sourced round analysis
 * grant counts (true in the beta, false at launch). These are entitlement
 * facts, not authorization: identity, participant admission and the
 * caller's debating seat are still evaluated separately.
 */
export function accountEntitlements(
  grants: readonly EntitlementGrant[],
  policy: { readonly betaGrantsPremium: boolean },
) {
  return {
    roundAnalysis: grants.some(
      (grant) =>
        grant.entitlement === 'round_analysis' &&
        (grant.source !== 'beta' || policy.betaGrantsPremium),
    ),
  };
}

/**
 * DEC-183 as amended 2026-10-26 (ISSUE-646): one flat policy. A live member
 * holding an `ai_rounds` grant may start up to the trusted monthly cap of AI
 * Rounds per UTC calendar month; any other account admits none (null). This
 * is a usage quota, never the round analysis entitlement.
 */
export function aiRoundAllowance(
  account: AccountAuthorizationFact | null,
  grants: readonly EntitlementGrant[],
  policy: { readonly monthlyCap: number },
): number | null {
  if (!Number.isSafeInteger(policy.monthlyCap) || policy.monthlyCap < 1)
    throw new RangeError('A positive monthly AI-round cap is required');
  return account?.member === true &&
    !account.erased &&
    grants.some((grant) => grant.entitlement === 'ai_rounds')
    ? policy.monthlyCap
    : null;
}
