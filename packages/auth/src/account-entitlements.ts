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
    coaching: policy.betaGrantsPremium && approvedBetaMember(account),
  };
}

/**
 * DEC-183 as amended 2026-10-26 (ISSUE-646): one flat beta policy. An
 * approved beta member may start up to the trusted monthly cap of AI Rounds
 * per UTC calendar month; any other account fact admits none (null). This is
 * a usage quota, never the coaching entitlement.
 */
export function aiRoundAllowance(
  account: AccountAuthorizationFact | null,
  policy: { readonly monthlyCap: number },
): number | null {
  if (!Number.isSafeInteger(policy.monthlyCap) || policy.monthlyCap < 1)
    throw new RangeError('A positive monthly AI-round cap is required');
  return approvedBetaMember(account) ? policy.monthlyCap : null;
}

const approvedBetaMember = (account: AccountAuthorizationFact | null) =>
  account?.member === true &&
  !account.erased &&
  account.beta?.state === 'approved' &&
  Number.isSafeInteger(account.beta.revision) &&
  account.beta.revision > 0;
