import type { AccountAuthorizationFact } from './authorization-facts';

/**
 * DEC-247: the beta grant is the sole premium source until billing exists.
 * These are entitlement facts, not authorization: identity, participant
 * admission and the caller's debating seat are still evaluated separately.
 */
export function accountEntitlements(
  account: AccountAuthorizationFact | null,
  policy: { readonly betaGrantsPremium: boolean },
) {
  return {
    coaching:
      policy.betaGrantsPremium &&
      account?.member === true &&
      !account.erased &&
      account.beta?.state === 'approved' &&
      Number.isSafeInteger(account.beta.revision) &&
      account.beta.revision > 0,
  };
}
