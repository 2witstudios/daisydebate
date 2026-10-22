import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import type { ReservedSQL } from 'bun';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from '../src/bounded-transaction';
import {
  recoverTransactionBackend,
  type OwnedBackend,
} from '../src/transaction-watchdog';
import { finishedOrBlockedBehind } from '../src/testing';
import { withFixture } from './constraint-helpers';
import { backendOf, withPool } from './bounded-transaction.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('lock contention rolls back within the server backstop and leaves unrelated backends usable', async () => {
  await withFixture(url, async (fixture) =>
    withPool(async (client) => {
      const roundId = await fixture.round();
      const holder = await fixture.sql.reserve();
      const [pidRow] = await holder`select pg_backend_pid() as pid`;
      await holder`begin`;
      await holder`select id from rounds where id=${roundId} for update`;
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      try {
        const start = performance.now();
        const attempt = run(async (tx) => {
          await tx.execute(
            sql`update rounds set resolution='blocked write' where id=${roundId}`,
          );
        });
        const refusal = assertRejects({
          given: 'an existing Round row lock',
          should: 'refuse the blocked transaction',
          actual: () => attempt,
          code: 'INFRASTRUCTURE',
        });
        const observed = await finishedOrBlockedBehind(
          attempt,
          fixture.sql,
          pidRow!.pid,
          { now: performance.now },
        );
        await refusal;
        const [alive] = await holder`select pg_backend_pid() as pid`;
        assert({
          given: 'observed real PostgreSQL lock contention',
          should: 'stop in2s without killing the lock holder',
          actual: {
            observed,
            bounded: performance.now() - start < 2800,
            holderAlive: alive!.pid === pidRow!.pid,
          },
          expected: { observed: 'blocked', bounded: true, holderAlive: true },
        });
        const value = await run(
          async (tx) => (await tx.execute(sql`select 7 as value`))[0],
        );
        assert({
          given: 'a recovered contended transaction',
          should: 'accept the next transaction from the same pool',
          actual: value,
          expected: { value: 7 },
        });
      } finally {
        await holder`rollback`;
        holder.release();
      }
    }),
  );
}, 15000);

test(
  'statement and idle transaction backstops are at most2s',
  async () =>
    withPool(async (client) => {
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      const timeouts = await run(
        async (tx) =>
          (
            await tx.execute(
              sql`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock, current_setting('idle_in_transaction_session_timeout') as idle`,
            )
          )[0],
      );
      assert({
        given: 'a bounded transaction before any application lock',
        should: 'install all three2s PostgreSQL backstops',
        actual: timeouts,
        expected: { statement: '2s', lock: '2s', idle: '2s' },
      });
      const started = performance.now();
      await assertRejects({
        given: 'a stalled PostgreSQL statement',
        should: 'cancel and roll back before the whole budget',
        actual: () =>
          run(async (tx) => {
            await tx.execute(sql`select pg_sleep(30)`);
          }),
        code: 'INFRASTRUCTURE',
      });
      assert({
        given: 'server statement timeout recovery',
        should: 'finish inside the3s whole budget',
        actual: performance.now() - started < 2900,
        expected: true,
      });
    }),
  15000,
);

test(
  'lost socket cancellation terminates only the exact owned backend within the recovery budget',
  async () =>
    withPool(async (client) => {
      const originalReserve = client.reserve.bind(client);
      let writer: ReservedSQL | undefined;
      let identity: OwnedBackend | undefined;
      let reservations = 0;
      // Fault injection loses only the writer socket close; all SQL and termination are real PG.
      client.reserve = async (options) => {
        const connection = await originalReserve(options);
        reservations += 1;
        if (reservations === 2) {
          writer = connection;
          connection.close = async () => {};
        }
        return connection;
      };
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      const survivor = await originalReserve();
      const survivorIdentity = await backendOf(survivor);
      try {
        const start = performance.now();
        await assertRejects({
          given: 'a native writer whose socket cancellation is lost',
          should: 'use its separately reserved watchdog to roll back',
          actual: () =>
            run(async (tx) => {
              identity = await backendOf(writer!);
              await writer!`set local statement_timeout=0`;
              await writer!`set local idle_in_transaction_session_timeout=0`;
              await tx.execute(sql`select pg_sleep(30)`);
            }),
          code: 'INFRASTRUCTURE',
        });
        const elapsed = performance.now() - start;
        const [row] =
          await survivor`select not exists(select 1 from pg_stat_activity where pid=${identity!.pid}) as absent`;
        const current = await backendOf(survivor);
        assert({
          given: 'forced cancellation loss against a real sleeping backend',
          should:
            'verify owned termination by4s and preserve an unrelated live backend',
          actual: {
            absent: row!.absent,
            bounded: elapsed >= 2950 && elapsed < 4100,
            survivor: current.pid === survivorIdentity.pid,
          },
          expected: { absent: true, bounded: true, survivor: true },
        });
      } finally {
        survivor.release();
        writer?.release();
      }
    }),
  15000,
);

test(
  'a reused PID with a different backend start is never terminated',
  async () =>
    withPool(async (client) => {
      const victim = await client.reserve();
      const control = await client.reserve();
      try {
        const identity = await backendOf(victim);
        const absent = await recoverTransactionBackend(control, {
          ...identity,
          started: '2000-01-01 00:00:00+00',
        });
        const current = await backendOf(victim);
        assert({
          given: 'the same PID with a different exact backend start',
          should:
            'treat the owned backend as absent without killing the current connection',
          actual: { absent, alive: current.pid === identity.pid },
          expected: { absent: true, alive: true },
        });
      } finally {
        victim.release();
        control.release();
      }
    }),
  15000,
);
