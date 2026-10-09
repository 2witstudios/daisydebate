import { loadAuthorizationAgeFact } from '@daisy/db/account-age';
import type { AuthorizationTransaction } from '@daisy/db/authorization';
import { loadAccountPolicyFacts as loadPolicyFacts } from '@daisy/auth/account-policy-facts';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
/** Keep the minimal fact reader bound to the same account-fenced transaction. */
export function loadAccountPolicyFacts(
  tx: AuthorizationTransaction,
  lockedAccounts: readonly (AccountAuthorizationFact | null)[],
  now: string,
) {
  return loadPolicyFacts({
    accounts: lockedAccounts,
    now,
    readAgeFact: (account, checkedAt) =>
      account.actorId
        ? loadAuthorizationAgeFact(tx, {
            userId: account.userId,
            actorId: account.actorId,
            accountRevision: account.revision,
            now: checkedAt,
          })
        : Promise.resolve({ state: 'unknown' as const }),
  });
}
