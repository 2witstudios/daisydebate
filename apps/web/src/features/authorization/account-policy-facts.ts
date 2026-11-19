import { bindAuthorizationAgeFact } from '@daisy/db/account-age';
import type { AuthorizationTransaction } from '@daisy/db/authorization';
import { bindMessagingContactFacts } from '@daisy/db/messaging';
import { loadAccountPolicyFacts as loadPolicyFacts } from '@daisy/auth/account-policy-facts';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
/**
 * Keep the minimal fact reader bound to the same account-fenced transaction:
 * each account's age, and what the DM rule reads about its contacts
 * (friendships, linked adults, request setting; decision 90).
 */
export function loadAccountPolicyFacts(
  tx: AuthorizationTransaction,
  lockedAccounts: readonly (AccountAuthorizationFact | null)[],
  now: string,
) {
  return loadPolicyFacts({
    accounts: lockedAccounts,
    now,
    readAgeFact: bindAuthorizationAgeFact(tx),
    readContactFacts: bindMessagingContactFacts(tx),
  });
}
