import { loadAccountAgeSource } from '@daisy/db/account-age';
import type { AuthorizationTransaction } from '@daisy/db/authorization';
import { loadAccountPolicyFacts as loadPolicyFacts } from '@daisy/auth/account-policy-facts';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
/** Keep the raw source reader bound to the same account-fenced transaction. */
export function loadAccountPolicyFacts(
  tx: AuthorizationTransaction,
  lockedAccounts: readonly (AccountAuthorizationFact | null)[],
  now: string,
) {
  return loadPolicyFacts({
    accounts: lockedAccounts,
    now,
    readAgeSource: (userId) => loadAccountAgeSource(tx, userId),
  });
}
