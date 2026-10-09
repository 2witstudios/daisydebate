import { createAppError } from '@daisy/errors';
import { accountAgeFact, type AccountAgeSource } from './account-age';
import type { AccountAuthorizationFact } from './authorization';
/** Bind the source reader to the caller's account-fenced transaction. Raw birth data stays in this composition. */
export async function loadAccountPolicyFacts({
  accounts,
  now,
  readAgeSource,
}: {
  readonly accounts: readonly (AccountAuthorizationFact | null)[];
  readonly now: string;
  readonly readAgeSource: (userId: string) => Promise<AccountAgeSource | null>;
}) {
  const present: AccountAuthorizationFact[] = accounts.map((account) => {
    if (!account) throw createAppError('AUTHORIZATION');
    return account;
  });
  return Promise.all(
    present.map(async (account) => ({
      account,
      age: accountAgeFact({
        source: await readAgeSource(account.userId),
        account,
        now,
      }),
    })),
  );
}
