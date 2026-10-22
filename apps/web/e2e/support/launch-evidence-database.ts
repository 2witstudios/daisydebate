import { SQL, type TransactionSQL } from 'bun';
import { resolve } from 'node:path';
import { admitLaunchCheckout } from './room-launch-admission';
import { requireLaunchSlot } from './room-launch-slot';

/** Fixture-only observations: admitted own slot, verified role, one read-only transaction. */
export async function readLaunchDatabase<T>(
  read: (transaction: TransactionSQL) => Promise<T>,
) {
  const checkout = resolve(import.meta.dir, '../../../..');
  const slot = requireLaunchSlot(checkout, process.env);
  await admitLaunchCheckout(checkout, slot.database);
  const client = new SQL(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    return await client.begin(async (transaction) => {
      await transaction`set transaction read only`;
      const [identity] =
        await transaction`select current_database() name, current_user role`;
      if (identity!.name !== slot.database || identity!.role !== 'daisy_e2e')
        throw new Error('Proof evidence target mismatch');
      return read(transaction);
    });
  } finally {
    await client.close();
  }
}
