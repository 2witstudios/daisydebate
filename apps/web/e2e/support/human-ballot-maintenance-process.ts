import { resolve } from 'node:path';
import { createDatabase } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { idSchema } from '@daisy/protocol';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../../src/features/round-finalization/maintenance';
import { requireLaunchSlot } from './room-launch-slot';
import { admitLaunchCheckout } from './room-launch-admission';

/** Drives the production maintenance finalizer for named Rounds under its own renewed web instance lease. */
if (import.meta.main) {
  const checkout = resolve(import.meta.dir, '../../../..');
  const slot = requireLaunchSlot(checkout, process.env);
  await admitLaunchCheckout(checkout, slot.database);
  const freeze = Bun.argv[2] === 'freeze';
  if (!['freeze', 'tick'].includes(Bun.argv[2] ?? ''))
    throw new Error('Explicit fixture maintenance mode required');
  const roundIds = Bun.argv.slice(3).map((id) => idSchema.parse(id));
  if (!roundIds.length || roundIds.length > 8)
    throw new Error('Explicit bounded ballot fixture scope required');
  const database = createDatabase({
    url: process.env.E2E_DATABASE_URL!,
    nextActorId: createId,
    maxConnections: 4,
  });
  try {
    const instanceId = createId();
    const operation = createRoundMaintenanceOperations({
      startHorizonMs: ROUND_START_HORIZON_MS,
      store: database,
      instanceId,
      ids: { next: createId },
      evaluate: async () => null,
    });
    const pending = new Set(roundIds);
    const deadline = performance.now() + 150_000;
    while (pending.size) {
      await database.renewServiceInstance({ instanceId, role: 'web' });
      for (const roundId of pending) {
        const result = await operation.finalize(roundId);
        if (!freeze || result.status === 'frozen') pending.delete(roundId);
        else if (result.status === 'terminal')
          throw new Error('Ballot fixture unexpectedly decided');
      }
      if (performance.now() > deadline)
        throw new Error('Actual capture cutoff/freeze not reached');
      if (pending.size) await Bun.sleep(500);
    }
    process.stdout.write(
      JSON.stringify({ roundIds, status: freeze ? 'frozen' : 'advanced' }),
    );
  } finally {
    await database.close();
  }
}
