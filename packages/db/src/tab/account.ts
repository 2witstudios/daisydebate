import { loadAuthorizationAccount } from '../authorization';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

export type TabAccount = NonNullable<
  Awaited<ReturnType<typeof loadAuthorizationAccount>>
>;

/** Reads the named counterpart under their own subject scope. */
export const loadTabCounterpart = async (
  tx: TabTransaction,
  userId: string,
  scope: TenantScope,
): Promise<TabAccount | null> => {
  const subject = { ...scope, subjectUserId: userId };
  await scopeTransaction(tx, subject);
  const account = await loadAuthorizationAccount(tx, userId);
  await scopeTransaction(tx, scope);
  return account;
};
