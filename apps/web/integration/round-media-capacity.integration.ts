import { requireTestServices } from '@daisy/config';
import { runAsBackgroundWork } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRuntimeRound } from './round-runtime.test-support';
import { withMediaRound } from './round-media.test-support';
import { roundTickProjection } from '../src/features/round-finalization/operations';

setupRitewayBun();
requireTestServices(process.env);
const refusal = 'Transcript transaction capacity unavailable';

test(
  'a public media admission keeps its reserve while background work holds every background slot (DEC-198)',
  async () =>
    withMediaRound(async (f) => {
      const { roundId: heldRound } = await startRuntimeRound(
        f,
        await f.assemble(),
      );
      const instanceId = createId();
      const lock = await f.sql.reserve();
      const holders: Promise<string>[] = [];
      const parked = async () =>
        Number(
          (
            await f.sql`select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`
          )[0]!.n,
        );
      // A real background-class maintenance transaction on the real runner and
      // pool, parked on the Round row this test holds: it keeps its slot.
      const hold = async () => {
        const before = await parked();
        const attempt = runAsBackgroundWork(() =>
          f.store.tickDueRound({
            instanceId,
            roundId: heldRound,
            buildProjection: roundTickProjection(createId),
          }),
        ).then(
          () => 'released',
          (error: Error) => error.message,
        );
        holders.push(attempt);
        const deadline = performance.now() + 2000;
        for (;;) {
          const settled = await Promise.race([attempt, Promise.resolve(null)]);
          if (settled !== null) return settled;
          if ((await parked()) > before) return 'held';
          if (performance.now() >= deadline)
            throw new Error('Background holder neither parked nor refused');
          await Bun.sleep(5);
        }
      };
      let held = 0,
        admitted = '',
        further = '';
      try {
        await f.store.renewServiceInstance({ instanceId, role: 'web' });
        await lock`begin`;
        await lock`select id from rounds where id=${heldRound} for update`;
        while ((await hold()) === 'held') held += 1;
        admitted = await f.mediaOperations
          .session(f.roundId, f.host.actorId)
          .then(
            (response) => response.state,
            (error: Error) => error.message,
          );
        further = await hold();
      } finally {
        await lock`rollback`;
        lock.release();
        await Promise.all(holders);
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
      }
      assert({
        given:
          'background maintenance transactions holding the real pool until the runner refuses one',
        should:
          'stop background work at the cap, still admit a public debater, and keep refusing background work',
        actual: { held, admitted, further },
        expected: { held: 3, admitted: 'ready', further: refusal },
      });
    }),
  30_000,
);
