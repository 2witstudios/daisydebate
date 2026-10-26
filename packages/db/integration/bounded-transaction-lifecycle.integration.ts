import type { TransactionMetadata } from '../src/transaction-lifecycle';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BoundedTransactionContext } from '../src/transaction-context';
import { reconcileCheckInAttempts } from '../src/check-in-attempts';
import {
  withCheckInAttempt as withAttempt,
  writeCheckInLedger,
} from './bounded-transaction-lifecycle.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual check-in marker commits before writer BEGIN and closes only after a known refusal', async () =>
  withAttempt(async ({ f, run, attempt, lifecycle }) => {
    const { attemptId } = attempt;
    let beforeBegin = false;
    let escaped: BoundedTransactionContext | undefined;
    let observed: unknown;
    await assertRejects({
      given: 'actual durable check-in lifecycle and a domain refusal',
      should: 'refuse the operation after opening its marker',
      code: 'CONFLICT',
      actual: () =>
        run(
          async (tx, _signal, metadata) => {
            const [marker] =
              await f.sql`select state,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp,backend_pid,backend_started_at::text as started from round_check_in_attempts where attempt_id=${attemptId}`;
            const [writer] = await tx.execute(
              sql`select pg_backend_pid() as pid`,
            );
            observed = observeReceipt(metadata, marker, writer!.pid);
            throw createAppError('CONFLICT');
          },
          {
            executionMs: 900,
            lifecycle: {
              open: async (control, metadata) => {
                escaped = control;
                await lifecycle.open(control, metadata);
                const [writer] = await control.execute(
                  sql`select xact_start is null as idle from pg_stat_activity where pid=${metadata.writer.pid} and backend_start::text=${metadata.writer.backendStart}`,
                );
                beforeBegin = writer?.idle === true;
              },
              close: lifecycle.close,
            },
          },
        ),
    });
    await assertRejects({
      given: 'an escaped control facade after its open transaction ended',
      should: 'refuse autocommit through a released/reused reservation',
      code: 'INVARIANT',
      actual: () =>
        escaped!.execute(
          sql`update rounds set resolution='escaped control' where id=${attempt.roundId}`,
        ),
    });
    const [marker] =
      await f.sql`select state from round_check_in_attempts where attempt_id=${attemptId}`;
    assert({
      given: 'separate committed marker visibility before competitive work',
      should:
        'preserve full precision identity and record a verified abort before returning refusal',
      actual: { beforeBegin, observed, finalState: marker?.state },
      expected: {
        beforeBegin: true,
        observed: { state: 'pending', receipt: true, identity: true },
        finalState: 'aborted',
      },
    });
  }));

test('a refusal answers itself when the reconciler settled its marker first (ISSUE-618)', async () =>
  withAttempt(async ({ f, run, attempt, lifecycle }) => {
    let reconciled = 0;
    await assertRejects({
      given:
        'a domain refusal whose writer is gone, and the availability reconciler settling its pending marker before the closing hook',
      should: 'answer the refusal, not an unconfirmed recovery',
      code: 'CONFLICT',
      actual: () =>
        run(
          async () => {
            throw createAppError('CONFLICT');
          },
          {
            executionMs: 900,
            lifecycle: {
              open: lifecycle.open,
              close: async (control, metadata, outcome) => {
                reconciled = await drizzle({ client: f.sql }).transaction(
                  (tx) => reconcileCheckInAttempts(tx, 100),
                );
                await lifecycle.close(control, metadata, outcome);
              },
            },
          },
        ),
    });
    const [marker] =
      await f.sql`select state from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
    assert({
      given: 'a marker the reconciler aborted after confirmed writer absence',
      should: 'keep that single verified abort',
      actual: { reconciled: reconciled > 0, state: marker?.state },
      expected: { reconciled: true, state: 'aborted' },
    });
  }));

test('successful writer COMMIT closes the actual ledger-bound marker before releasing resources', async () =>
  withAttempt(async ({ f, run, attempt, lifecycle }) => {
    const result = await run(
      async (tx) => {
        await writeCheckInLedger(tx, attempt);
        return 'committed';
      },
      { executionMs: 900, lifecycle },
    );
    const [marker] =
      await f.sql`select state from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
    assert({
      given:
        'a confirmed writer COMMIT with its matching durable command ledger',
      should: 'close the marker before returning success',
      actual: { result, state: marker?.state },
      expected: { result: 'committed', state: 'committed' },
    });
  }));

for (const failure of ['caught-sql-error', 'caught-nested-control']) {
  test(`lifecycle capability refuses ${failure} without committing its earlier marker`, async () =>
    withAttempt(async ({ f, run, attempt, lifecycle }) => {
      let entered = false;
      await assertRejects({
        given: 'an open-hook callback swallowing a database/control error',
        should: 'refuse and keep competitive work unopened',
        code: 'INFRASTRUCTURE',
        actual: () =>
          run(
            async () => {
              entered = true;
            },
            {
              executionMs: 900,
              lifecycle: {
                open: async (control, metadata) => {
                  await lifecycle.open(control, metadata);
                  try {
                    if (failure === 'caught-sql-error')
                      await control.execute(sql`select 1/0`);
                    else Reflect.get(control, 'transaction');
                  } catch {
                    /* Fault injection deliberately swallows the failure. */
                  }
                },
                close: lifecycle.close,
              },
            },
          ),
      });
      const [row] =
        await f.sql`select count(*)::int as markers from round_check_in_attempts where attempt_id=${attempt.attemptId}`;
      assert({
        given: 'refused lifecycle COMMIT/control ownership',
        should: 'leave no marker write or competitive callback',
        actual: { entered, markers: row!.markers },
        expected: { entered: false, markers: 0 },
      });
    }));
}

function observeReceipt(
  metadata: TransactionMetadata | undefined,
  marker: Record<string, unknown> | undefined,
  pid: unknown,
) {
  const { receivedAt, writer } = metadata ?? {
    receivedAt: 'missing',
    writer: { pid: -1, backendStart: 'missing' },
  };
  return {
    state: marker?.state,
    receipt: /\.\d{6}Z$/.test(receivedAt) && marker?.stamp === receivedAt,
    identity:
      writer.pid === pid &&
      marker?.backend_pid === pid &&
      marker?.started === writer.backendStart,
  };
}
