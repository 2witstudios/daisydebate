import { SQL } from 'bun';
import { resolve } from 'node:path';
import { idSchema } from '@daisy/protocol';
import { requireLaunchSlot } from './room-launch-slot';

/**
 * Fixture-only write for the Node-driven realtime proof: requests cannot make
 * a Room private (DEC-206), so its own slot stores one Room private directly.
 */
if (import.meta.main) {
  requireLaunchSlot(resolve(import.meta.dir, '../../../..'), process.env);
  const roomId = idSchema.parse(Bun.argv[2]);
  const sql = new SQL(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`update rooms set visibility='private' where id=${roomId}`;
  } finally {
    await sql.close();
  }
}
