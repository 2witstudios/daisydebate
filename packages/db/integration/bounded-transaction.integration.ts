import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('the whole transcript transaction expires across individually short statements', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const client = new SQL(url, { max: 4 });
    const run = createBoundedTransaction({
      client,
      maxConnections: 4,
      now: performance.now,
    });
    try {
      const started = performance.now();
      await assertRejects({
        given: 'individually short statements exceeding the whole budget',
        should: 'refuse the transaction',
        code: 'INFRASTRUCTURE',
        actual: () =>
          run(async (tx) => {
            await tx.execute(
              sql`update rounds set resolution='uncommitted transcript' where id=${roundId}`,
            );
            for (let i = 0; i < 7; i++)
              await tx.execute(sql`select pg_sleep(0.5)`);
          }),
      });
      const elapsed = performance.now() - started;
      const [row] =
        await fixture.sql`select resolution from rounds where id=${roundId}`;
      assert({
        given: 'seven subsecond statements in one transcript transaction',
        should:
          'abort the whole transaction within3s plus1s recovery and roll back its earlier write',
        actual: {
          withinBudget: elapsed < 4100,
          rolledBack: row!.resolution !== 'uncommitted transcript',
        },
        expected: { withinBudget: true, rolledBack: true },
      });
    } finally {
      await client.close({ timeout: 0 });
    }
  });
}, 15000);
