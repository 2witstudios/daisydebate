import { resolve } from 'node:path';
import { createDatabase } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { idSchema } from '@daisy/protocol';
import { createRoundFinalizationOperations } from '../../src/features/round-finalization/operations';
import { requireLaunchSlot } from './room-launch-slot';
import { admitLaunchCheckout } from './room-launch-admission';

/** Fixture invocation of the actual finalizer, not proof of the pending D5 public scheduler. */
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
    const operation = createRoundFinalizationOperations({
      store: database,
      nextSegmentId: createId,
    });
    const pending = new Set(roundIds);
    const deadline = performance.now() + 150_000;
    while (pending.size) {
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
