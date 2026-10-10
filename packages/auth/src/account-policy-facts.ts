import { createAppError } from '@daisy/errors';
import type { AccountAgeFact } from './account-age';
import type { AccountAuthorizationFact } from './authorization';
/** Bind the canonical minimal fact reader to the same account-fenced transaction. */
export async function loadAccountPolicyFacts({
  accounts,
  now,
  readAgeFact,
}: {
  readonly accounts: readonly (AccountAuthorizationFact | null)[];
  readonly now: string;
  readonly readAgeFact: (
    account: AccountAuthorizationFact,
    now: string,
  ) => Promise<AccountAgeFact>;
}) {
  const present: AccountAuthorizationFact[] = accounts.map((account) => {
    if (!account) throw createAppError('AUTHORIZATION');
    return account;
  });
  return Promise.all(
    present.map(async (account) => ({
      account,
      age: await readAgeFact(account, now),
    })),
  );
}
