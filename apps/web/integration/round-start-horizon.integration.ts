import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ROUND_START_HORIZON_MS } from '../src/features/round-finalization/maintenance';
import { ordinaryMaintenance } from './round-maintenance.test-support';
import { readyBotJudgedRoom } from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a Round still scheduled past its start horizon is abandoned once across two maintenance instances, releasing its bot slot (DEC-214)', async () =>
  withRoomRuntime(
    async (f) => {
      const expired = (
        await launchRuntimeRound(f, (await readyBotJudgedRoom(f)).room)
      ).roundId;
      // A second Room needs its own cast: one user holds one active Room (ADR 0070).
      const fresh = (
        await launchRuntimeRound(f, await f.assemble({}, await f.freshCast()))
      ).roundId;
      // The injected clock: this Round was launched past its horizon.
      await f.sql`update rounds set created_at=clock_timestamp()-${ROUND_START_HORIZON_MS + 60_000}*interval '1 millisecond' where id=${expired}`;
      const held = await f.store.readRoundBotAdmissionStatus(f.host.actorId);
      const instances = [createId(), createId()];
      for (const instanceId of instances)
        await f.store.renewServiceInstance({ instanceId, role: 'web' });
      try {
        const [first, second] = instances.map((instanceId) =>
          ordinaryMaintenance(f.store, instanceId),
        );
        const discovered = await first!.discover();
        await Promise.all([first!.tick(expired), second!.tick(expired)]);
        const abandoned = (await f.store.getRound(expired))!;
        await second!.tick(expired);
        const again = (await f.store.getRound(expired))!;
        const [ratings] =
          await f.sql`select count(*)::int as n from rating_changes where round_id=${expired}`;
        const released = await f.store.readRoundBotAdmissionStatus(
          f.host.actorId,
        );
        assert({
          given:
            'a bot Round launched past its start horizon and a fresh Round, ticked concurrently by two web instances and then again',
          should:
            'discover and abandon only the expired Round, once, with no outcome, start or rating, and free its allowance',
          actual: {
            discovered: [
              discovered.includes(expired),
              discovered.includes(fresh),
            ],
            abandoned: {
              status: abandoned.status,
              outcome: abandoned.outcome,
              startedAt: abandoned.startedAt,
              completed: abandoned.completedAt !== null,
            },
            idempotent: again.version === abandoned.version,
            fresh: (await f.store.getRound(fresh))!.status,
            ratings: ratings!.n,
            allowance: [held?.remaining, released?.remaining],
          },
          expected: {
            discovered: [true, false],
            abandoned: {
              status: 'abandoned',
              outcome: null,
              startedAt: null,
              completed: true,
            },
            idempotent: true,
            fresh: 'scheduled',
            ratings: 0,
            allowance: [0, 1],
          },
        });
      } finally {
        await f.sql`delete from service_instances where instance_id in (${instances[0]!},${instances[1]!})`;
      }
    },
    { botBusyCap: 4 },
  ));
