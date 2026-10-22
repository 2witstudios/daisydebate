import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { finishedOrBlockedBehind } from '../src/testing';
import { withFixture } from './constraint-helpers';
import { withPool } from './bounded-transaction.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the attendance execution slice exposes the first setup receipt and fits recovery before2s', async () =>
  withPool(async (client) => {
    const run = createBoundedTransaction({
      client,
      maxConnections: 4,
      now: performance.now,
      executionMs: 900,
    });
    const result = await run(async (tx, _signal, receipt) => {
      const [row] = await tx.execute(
        sql`select statement_timestamp() as now,current_setting('statement_timeout') as statement,current_setting('idle_in_transaction_session_timeout') as idle`,
      );
      return {
        received: receipt?.receivedAt,
        after: row!.now,
        statement: row!.statement,
        idle: row!.idle,
      };
    });
    assert({
      given: 'a900ms execution slice with1s recovery reserve',
      should:
        'capture receipt before callback statements and install backstops within the execution slice',
      actual: {
        receipt:
          typeof result.received === 'string' &&
          Date.parse(result.received) <=
            new Date(result.after as string).getTime(),
        statement: result.statement,
        idle: result.idle,
      },
      expected: { receipt: true, statement: '900ms', idle: '900ms' },
    });
  }));

test(
  'real Round contention leaves no outstanding attendance transaction at2s',
  async () =>
    withFixture(databaseUrl, async (f) =>
      withPool(async (client) => {
        const roundId = await f.round();
        const holder = await f.sql.reserve();
        await holder`begin`;
        const [backend] = await holder`select pg_backend_pid() as pid`;
        await holder`select id from rounds where id=${roundId} for update`;
        const run = createBoundedTransaction({
          client,
          maxConnections: 4,
          now: performance.now,
          executionMs: 900,
        });
        let receivedAt: string | undefined;
        try {
          const started = performance.now();
          const attempt = run(async (tx, _signal, receipt) => {
            receivedAt = receipt?.receivedAt;
            await tx.execute(
              sql`update rounds set resolution='late attendance' where id=${roundId}`,
            );
          });
          const refusal = assertRejects({
            given: 'an on-time receipt blocked behind a real Round lock',
            should:
              'cancel and verify backend absence within the2s attendance budget',
            code: 'INFRASTRUCTURE',
            actual: () => attempt,
          });
          const observed = await finishedOrBlockedBehind(
            attempt,
            f.sql,
            backend!.pid,
            { now: performance.now },
          );
          await refusal;
          const elapsed = performance.now() - started;
          const [alive] = await holder`select pg_backend_pid() as pid`;
          const next = await run(
            async (tx) => (await tx.execute(sql`select 1 as reusable`))[0],
          );
          assert({
            given: 'observed contention with a separately owned lock holder',
            should:
              'finish before2s with first receipt captured, holder untouched and same-pool capacity reusable',
            actual: {
              observed,
              bounded: elapsed <= 2000,
              receipt: typeof receivedAt === 'string',
              holder: alive!.pid === backend!.pid,
              next,
            },
            expected: {
              observed: 'blocked',
              bounded: true,
              receipt: true,
              holder: true,
              next: { reusable: 1 },
            },
          });
        } finally {
          await holder`rollback`;
          holder.release();
        }
      }),
    ),
  15000,
);
