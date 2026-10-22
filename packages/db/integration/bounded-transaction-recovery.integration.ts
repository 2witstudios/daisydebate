import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import type { ReservedSQL } from 'bun';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from '../src/bounded-transaction';
import type { OwnedBackend } from '../src/transaction-watchdog';
import { backendOf, withPool } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

test(
  'unconfirmed watchdog recovery stays pending and permits an idempotent retry after service recovery',
  async () =>
    withPool(async (client) => {
      const originalReserve = client.reserve.bind(client);
      const connections: ReservedSQL[] = [];
      let identity: OwnedBackend | undefined;
      client.reserve = async (options) => {
        const connection = await originalReserve(options);
        connections.push(connection);
        if (connections.length === 2) {
          await connections[0]!.close({ timeout: 0 });
          connection.close = async () => {};
        }
        return connection;
      };
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      try {
        let message = 'accepted';
        try {
          await run(async (tx) => {
            identity = await backendOf(connections[1]!);
            await tx.execute(sql`set local statement_timeout=0`);
            await tx.execute(sql`select pg_sleep(30)`);
          });
        } catch (error) {
          if (!isAppError(error)) throw error;
          message = error.message;
        }
        assert({
          given:
            'a lost writer cancellation and unavailable watchdog connection',
          should:
            'report pending recovery rather than claim rollback or successful finalization',
          actual: message,
          expected: 'Transcript transaction recovery pending',
        });
      } finally {
        client.reserve = originalReserve;
        if (identity)
          await client`select pg_terminate_backend(pid,500) from pg_stat_activity where pid=${identity.pid} and backend_start::text=${identity.started}`;
        connections[1]?.release();
      }
      assert({
        given: 'restored control capacity after uncertain cancellation',
        should: 'allow a fresh idempotent attempt to complete',
        actual: await run(
          async (tx) => (await tx.execute(sql`select 9 as value`))[0],
        ),
        expected: { value: 9 },
      });
    }),
  15000,
);

test(
  'connection acquisition consumes the whole budget without harming existing pool users',
  async () =>
    withPool(async (client) => {
      const held = await Promise.all([
        client.reserve(),
        client.reserve(),
        client.reserve(),
        client.reserve(),
      ]);
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      try {
        const start = performance.now();
        let entered = false;
        await assertRejects({
          given: 'a pool with every connection already held',
          should: 'expire before obtaining any writer or lock',
          actual: () =>
            run(async () => {
              entered = true;
            }),
          code: 'INFRASTRUCTURE',
        });
        const alive = await held[0]!`select 1 as alive`;
        assert({
          given: 'reservation exhausted the3s transaction budget',
          should: 'avoid entering work and preserve other reservations',
          actual: {
            entered,
            bounded: performance.now() - start < 3300,
            alive: alive[0]!.alive,
          },
          expected: { entered: false, bounded: true, alive: 1 },
        });
      } finally {
        for (const connection of held) connection.release();
      }
    }),
  15000,
);

test(
  'an idle application stall loses its transaction after2s and cannot commit when resumed',
  async () =>
    withPool(async (client) => {
      const entered = Promise.withResolvers<number>();
      const resume = Promise.withResolvers<void>();
      const run = createBoundedTransaction({
        client,
        maxConnections: 4,
        now: performance.now,
      });
      const work = run(async (tx) => {
        const [backend] = await tx.execute(sql`select pg_backend_pid() as pid`);
        entered.resolve(backend!.pid as number);
        await resume.promise;
        return 42;
      });
      const refusal = assertRejects({
        given: 'an application callback idle in transaction',
        should: 'refuse committing after PostgreSQL ends its idle session',
        actual: () => work,
        code: 'INFRASTRUCTURE',
      });
      const pid = await entered.promise;
      const start = performance.now();
      try {
        for (;;) {
          const [row] =
            await client`select not exists(select 1 from pg_stat_activity where pid=${pid}) as absent`;
          if (row!.absent) break;
          if (performance.now() - start > 2800)
            throw new Error(
              'Idle transaction was not terminated by PostgreSQL',
            );
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        resume.resolve();
      }
      await refusal;
      assert({
        given: 'observed backend termination during an application stall',
        should: 'release the idle backend within its2s backstop',
        actual: performance.now() - start < 2800,
        expected: true,
      });
    }),
  15000,
);
