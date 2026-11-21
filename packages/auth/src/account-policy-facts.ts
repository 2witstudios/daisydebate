import { createAppError } from '@daisy/errors';
import type { AccountAgeFact } from './account-age';
import type {
  AccountAuthorizationFact,
  SocialAccountFact,
  SocialContactFact,
} from './authorization';
/**
 * Bind the canonical minimal fact reader to the same account-fenced
 * transaction. With `readContactFacts`, each account also carries what the
 * DM rule reads about it (decision 90), from the same transaction.
 */
export async function loadAccountPolicyFacts({
  accounts,
  now,
  readAgeFact,
  readContactFacts,
}: {
  readonly accounts: readonly (AccountAuthorizationFact | null)[];
  readonly now: string;
  readonly readAgeFact: (
    account: AccountAuthorizationFact,
    now: string,
  ) => Promise<AccountAgeFact>;
  /** One contact fact per account, in the order given. */
  readonly readContactFacts?: (
    accounts: readonly SocialAccountFact[],
  ) => Promise<readonly SocialContactFact[]>;
}): Promise<SocialAccountFact[]> {
  const present: AccountAuthorizationFact[] = accounts.map((account) => {
    if (!account) throw createAppError('AUTHORIZATION');
    return account;
  });
  const facts = await Promise.all(
    present.map(async (account) => ({
      account,
      age: await readAgeFact(account, now),
    })),
  );
  if (!readContactFacts) return facts;
  const contacts = await readContactFacts(facts);
  if (contacts.length !== facts.length) throw createAppError('INFRASTRUCTURE');
  return facts.map((fact, index) => ({ ...fact, contact: contacts[index]! }));
}
