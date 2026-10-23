import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withAttendanceRound } from './attendance.test-support';
import { startRuntimeRound } from './round-runtime.test-support';
import {
  maintenanceAvailability,
  maintenanceTestTimers as timers,
} from './round-maintenance.test-support';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../src/features/round-finalization/maintenance';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { startRoundMaintenance } from '../src/features/round-finalization/service';

setupRitewayBun();
requireTestServices(process.env);

test('five actual Rounds leave shared bounded capacity for media and first-receipt attendance', async () =>
  withAttendanceRound(async ({ f, attendance, roundId, segmentId }) => {
    for (let i = 0; i < 4; i += 1)
      await startRuntimeRound(f, await f.assemble());
    const instanceId = createId();
    const failures: unknown[] = [],
      stamps: string[] = [];
    const availability = maintenanceAvailability({
      store: f.store,
      instanceId,
      stamps,
      failed: () => failures.push('availability-failed'),
    });
    let maintenance: ReturnType<typeof startRoundMaintenance> | undefined;
    try {
      await availability.firstSample;
      const operations = createRoundMaintenanceOperations({
        startHorizonMs: ROUND_START_HORIZON_MS,
        store: f.store,
        instanceId,
        ids: { next: createId },
        evaluate: attendance.evaluate,
      });
      const discovered = await operations.discover();
      maintenance = startRoundMaintenance({
        ...operations,
        timers,
        failed: (error) => failures.push(error),
      });
      await maintenance.ready;
      const began = performance.now();
      const [binding, receipt] = await Promise.all([
        f.store.mediaSessions.ensureBinding({
          roundId,
          actorId: f.host.actorId,
          buildProjection: roundTickProjection(createId),
        }),
        attendance.checkIn(
          { kind: 'human', actorId: f.host.actorId },
          roundId,
          { version: 1, commandId: createId(), segmentId },
        ),
      ]);
      const elapsed = performance.now() - began;
      const [facts] =
        await f.sql`select (select count(*)::int from round_check_ins where round_id=${roundId}) as receipts,(select count(*)::int from round_check_in_attempts where round_id=${roundId} and state='pending') as pending`;
      assert({
        given:
          'five actual active Rounds, default pool10 and the real availability/maintenance loops sharing the root bounded counter',
        should:
          'admit authorized media and a durable attendance receipt within2s without capacity failures or unresolved attempts',
        actual: {
          rounds: discovered.length,
          media: binding.roundId,
          segment: receipt.segmentId,
          withinBudget: elapsed <= 2000,
          facts,
          failures,
        },
        expected: {
          rounds: 5,
          media: roundId,
          segment: segmentId,
          withinBudget: true,
          facts: { receipts: 1, pending: 0 },
          failures: [],
        },
      });
    } finally {
      await maintenance?.stop();
      await availability.service.stop();
      for (const at of stamps)
        await f.sql`delete from availability_samples where at=${at}::timestamptz`;
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));
