import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { storedCommand } from './command-record';
import type { TabTransaction } from './tab-transaction';

/** A created aggregate's public identity lets a retry reach its original receipt. */
export const storedCreationCommand = async (
  tx: TabTransaction,
  scope: TenantScope,
  createdScope: TenantScope,
  commandId: string,
) => {
  await scopeTransaction(tx, createdScope);
  const recorded = await storedCommand(tx, commandId);
  await scopeTransaction(tx, scope);
  return recorded;
};
