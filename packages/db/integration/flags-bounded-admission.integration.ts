import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { lockAuthorizationActors } from '../src/authorization';
import { requireFlagAdmission } from '../src/flags';
import { lockFlags } from '../src/flags-lock';
import { testLane } from '../src/testing-lane';
import { withPool } from './bounded-transaction.test-support';
import { withFlags, flagCommand } from './flags.test-support';

requireTestServices(process.env);
setupRitewayBun();
test('Flags admission works on the guarded bounded transaction facade without changing adapter-owned settings', async () => {
  await withFlags(async ({ fixture, store, key, userId, actorId }) => {
    await store.runFlagCommand(flagCommand(key, 0));
    await withPool(async (client) => {
      const run = createBoundedTransaction({
        lane: testLane(client, 4),
        now: performance.now,
      });
      let decided = false;
      const admittedAt = await run(async (tx) => {
        await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
        const result = await requireFlagAdmission(tx, userId, {
          keys: [key],
          decide: (snapshot) => {
            decided = true;
            return (
              snapshot.kind === 'available' &&
              snapshot.flags[0]!.state === 'enabled'
            );
          },
        });
        await tx.execute(
          sql`update users set name=${result.admittedAt} where id=${userId}`,
        );
        return result.admittedAt;
      });
      const [witness] =
        await fixture.sql`select name from users where id=${userId}`;
      assert({
        given:
          'Billing uses the actual guarded bounded transaction factory and canonical account fence',
        should: 'reach the synchronous policy and commit its sampled instant',
        actual: { decided, name: witness!.name },
        expected: { decided: true, name: admittedAt },
      });
      await assertRejects({
        given: 'an application attempts configuration through the same facade',
        should: 'still refuse configuration changes',
        actual: () =>
          run((tx) =>
            tx.execute(sql`select set_config('lock_timeout','0',true)`),
          ),
        code: 'INVARIANT',
      });
      await assertRejects({
        given: 'a bounded admission tries to upgrade the shared Flags lock',
        should: 'refuse using actual PostgreSQL held locks',
        actual: () =>
          run(async (tx) => {
            await lockFlags(tx, 'read');
            await lockFlags(tx, 'write');
          }),
        code: 'INVARIANT',
      });
      await assertRejects({
        given:
          'durable work stalls after admission on the actual bounded facade',
        should: 'roll back through the existing deadline/watchdog',
        actual: () =>
          run(
            async (tx) => {
              await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
              await requireFlagAdmission(tx, userId, {
                keys: [key],
                decide: () => true,
              });
              await tx.execute(
                sql`update users set name='not committed' where id=${userId}`,
              );
              await tx.execute(sql`select pg_sleep(0.2)`);
            },
            { executionMs: 100 },
          ),
        code: 'INFRASTRUCTURE',
      });
      const [after] =
        await fixture.sql`select name from users where id=${userId}`;
      assert({
        given: 'the expired bounded admission',
        should: 'leave only the earlier committed witness',
        actual: after!.name,
        expected: admittedAt,
      });
    });
  });
});
