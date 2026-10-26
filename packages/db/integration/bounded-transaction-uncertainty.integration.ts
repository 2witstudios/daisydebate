import { requireTestServices } from '@daisy/config';
import { createAppError, isAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAvailabilitySampler } from '../src/availability-operations';
import { reconcileCheckInAttempts } from '../src/check-in-attempts';
import { finishedOrBlockedBehind } from '../src/testing';
import type { TransactionSettlement } from '../src/transaction-settlement';
import {
  withCheckInAttempt as withAttempt,
  writeCheckInLedger,
} from './bounded-transaction-lifecycle.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const fault of ['cleanup-failure', 'lost-commit-reply']) {
  test(`durable uncertainty survives ${fault} until backend and fresh ledger reconciliation`, async () =>
    withAttempt(async ({ f, run, client, attempt, lifecycle }) => {
      let settlement: TransactionSettlement | undefined;
      const originalReserve = client.reserve.bind(client);
      let reserved = 0;
      if (fault === 'lost-commit-reply')
        client.reserve = async (options) => {
          const connection = await originalReserve(options);
          reserved += 1;
          if (reserved !== 2) return connection;
          return new Proxy(connection, {
            apply(target, thisArg, args) {
              const query = Reflect.apply(target, thisArg, args);
              const template = args[0];
              if (Array.isArray(template) && template[0] === 'commit')
                return query.then(() => {
                  throw new Error('injected lost COMMIT reply');
                });
              return query;
            },
          });
        };
      try {
        await run(
          async (tx) => {
            await writeCheckInLedger(tx, attempt);
          },
          {
            executionMs: 900,
            lifecycle: {
              open: lifecycle.open,
              close:
                fault === 'lost-commit-reply'
                  ? lifecycle.close
                  : async () => {
                      throw createAppError(
                        'INFRASTRUCTURE',
                        'injected cleanup failure',
                      );
                    },
            },
          },
        );
        throw new Error('Expected pending cleanup');
      } catch (error) {
        if (!isAppError(error)) throw error;
        settlement = (error.cause as { settlement?: TransactionSettlement })
          ?.settlement;
      } finally {
        client.reserve = originalReserve;
      }
      const sampler = createAvailabilitySampler(client);
      let stamp: string | undefined;
      try {
        const sample = await sampler.sample({
          publicProbeHealthy: true,
        });
        if (sample === null) throw new Error('Sampler was not elected');
        stamp = sample.at;
        const [before] =
          await f.sql`select state from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
        assert({
          given:
            'actual writer COMMIT with lost reply or failed durable cleanup',
          should: 'retain pending evidence and refuse healthy availability',
          actual: {
            state: before!.state,
            healthy: sample.healthy,
            cause: sample.cause,
            handle: typeof settlement!.confirm,
          },
          expected: {
            state: 'pending',
            healthy: false,
            cause: 'check_in_pending',
            handle: 'function',
          },
        });
        if (!settlement) throw new Error('Missing settlement handle');
        await settlement.confirm();
        const absence = await settlement.settled;
        const reconciled = await run(
          (tx) => reconcileCheckInAttempts(tx, 100),
          {
            executionMs: 900,
          },
        );
        const [after] =
          await f.sql`select state from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
        assert({
          given:
            'positive backend absence followed by fresh READ COMMITTED ledger reconciliation',
          should: 'recognize actual COMMIT rather than mislabel it rollback',
          actual: { absence, reconciled, state: after!.state },
          expected: {
            absence: 'backend-absent',
            reconciled: 1,
            state: 'committed',
          },
        });
      } finally {
        await sampler.close();
        if (stamp)
          await f.sql`delete from availability_samples where at=${stamp}::timestamptz`;
      }
    }));
}

test(
  'actual marked Round contention aborts and closes uncertainty before2s without killing its holder',
  async () =>
    withAttempt(async ({ f, run, attempt, lifecycle }) => {
      const holder = await f.sql.reserve();
      await holder`begin`;
      const [holding] = await holder`select pg_backend_pid() as pid`;
      let pending: unknown;
      let writer: { pid: number; backendStart: string } | undefined;
      try {
        const started = performance.now();
        const work = run(
          async (tx, _signal, metadata) => {
            writer = metadata.writer;
            // Acquire contention after durable admission; the marker is already committed.
            await holder`select id from rounds where id=${attempt.roundId} for update`;
            const [row] =
              await f.sql`select state from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
            pending = row?.state;
            await tx.execute(
              sql`update rounds set resolution='blocked check-in' where id=${attempt.roundId}`,
            );
          },
          { executionMs: 900, lifecycle },
        );
        const refused = assertRejects({
          given: 'an admitted check-in blocked by a real Round writer',
          should: 'abort inside its execution/recovery envelope',
          code: 'INFRASTRUCTURE',
          actual: () => work,
        });
        const blocked = await finishedOrBlockedBehind(
          work,
          f.sql,
          holding!.pid,
          { now: performance.now },
        );
        await refused;
        const elapsed = performance.now() - started;
        const [marker] =
          await f.sql`select state from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
        const [alive] = await holder`select pg_backend_pid() as pid`;
        const [backend] =
          await f.sql`select exists(select 1 from pg_stat_activity where pid=${writer!.pid} and backend_start::text=${writer!.backendStart}) as present`;
        assert({
          given: 'durable receipt before the contended Round lock',
          should:
            'retain holder, verify exact writer absence and durably abort before2000ms',
          actual: {
            blocked,
            pending,
            bounded: elapsed <= 2000,
            state: marker?.state,
            holder: alive!.pid === holding!.pid,
            writerAbsent: !backend!.present,
          },
          expected: {
            blocked: 'blocked',
            pending: 'pending',
            bounded: true,
            state: 'aborted',
            holder: true,
            writerAbsent: true,
          },
        });
      } finally {
        await holder`rollback`;
        holder.release();
      }
    }),
  15000,
);
