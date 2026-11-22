import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { storedCommand } from './command-record';
import type { Tx } from '../tx';

/** A created aggregate's public identity lets a retry reach its original receipt. */
export const storedCreationCommand = async (
  tx: Tx,
  scope: TenantScope,
  createdScope: TenantScope,
  commandId: string,
) => {
  await scopeTransaction(tx, createdScope);
  const recorded = await storedCommand(tx, commandId);
  await scopeTransaction(tx, scope);
  return recorded;
};
