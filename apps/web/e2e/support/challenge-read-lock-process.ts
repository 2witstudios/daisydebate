import { SQL } from 'bun';
import { resolve } from 'node:path';
import { admitLaunchCheckout } from './room-launch-admission';
import { requireLaunchSlot } from './room-launch-slot';

// Block the real optional shell read without changing any challenge data.
const checkout = resolve(import.meta.dir, '../../../..');
const slot = requireLaunchSlot(checkout, process.env);
await admitLaunchCheckout(checkout, slot.database);
const sql = new SQL(process.env.E2E_DATABASE_URL!, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '2s'`;
    await tx`set local idle_in_transaction_session_timeout = '15s'`;
    await tx`lock table challenges in access exclusive mode`;
    process.stdout.write('locked\n');
    await Bun.stdin.text();
  });
} finally {
  await sql.close();
}
