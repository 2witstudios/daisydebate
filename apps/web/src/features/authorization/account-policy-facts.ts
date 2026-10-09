import { loadAccountAgeSource } from '@daisy/db/account-age';
import type { AuthorizationTransaction } from '@daisy/db/authorization';
import { accountAgeFact } from '@daisy/auth/account-age';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
/**
 * Inject this server-only composition into MSG's same-transaction frame.
 * Accounts are already fenced; birth data remains inside this composition and
 * never enters the messaging callback, telemetry, outbox or channel rows.
 */
export async function loadAccountPolicyFacts(
  tx: AuthorizationTransaction,
  lockedAccounts: readonly (AccountAuthorizationFact | null)[],
  now: string,
) {
  return Promise.all(
    lockedAccounts.map(async (account) => {
      if (!account) throw createAppError('AUTHORIZATION');
      const source = await loadAccountAgeSource(tx, account.userId);
      return { account, age: accountAgeFact({ source, account, now }) };
    }),
  );
}
