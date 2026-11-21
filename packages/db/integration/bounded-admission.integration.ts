import { assertRejects } from '@daisy/errors/testing';
import { createAppError, isAppError } from '@daisy/errors';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sql } from 'drizzle-orm';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { isCapacityRefusal } from '../src/capacity';
import { testLane } from '../src/testing-lane';
import { withBoundedRound, withPool } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('invalid budgets reserve no backend and a successful writer releases both slots', () =>
  withPool(async (client) => {
    const reserve = client.reserve.bind(client);
    let reservations = 0;
    client.reserve = (options) => {
      reservations++;
      return reserve(options);
    };
    const lane = testLane(client, 2);
    const make = (executionMs?: number) =>
      createBoundedTransaction({
        lane,
        now: performance.now,
        ...(executionMs === undefined ? {} : { executionMs }),
      });
    for (const executionMs of [0, 3001, 1.5, Number.NaN]) {
      await assertRejects({
        given: 'an invalid execution bound',
        should: 'reject factory configuration and call overrides',
        actual: () => make(executionMs),
        code: 'INVARIANT',
      });
      await assertRejects({
        given: 'the same invalid per-call bound',
        should: 'reject before reserving a backend',
        actual: () => make()(async () => 'unused', { executionMs }),
        code: 'INVARIANT',
      });
    }
    const before = reservations;
    const run = make();
    const read = () =>
      run(async (tx, signal, receipt) => {
        const [backend] = await tx.execute(
          sql`select pg_backend_pid() as pid, backend_start::text as started from pg_stat_activity where pid=pg_backend_pid()`,
        );
        return [
          signal.aborted,
          Object.isFrozen(receipt),
          receipt?.writer.pid === backend?.pid,
          receipt?.writer.backendStart === backend?.started,
          /\.\d{6}Z$/.test(receipt?.receivedAt ?? ''),
        ];
      });
    assert({
      given:
        'refused bounds followed by two successful writers limited to one writer at a time',
      should:
        'reserve nothing on refusal, confirm each native writer receipt and reuse both slots',
      actual: [before, await read(), await read(), reservations],
      expected: [
        0,
        [false, true, true, true, true],
        [false, true, true, true, true],
        4,
      ],
    });
  }));

test('bounded writes reserve recovery capacity and release a refused wait', () =>
  withPool(async (client) => {
    const run = createBoundedTransaction({
      lane: testLane(client, 4, 0),
      now: performance.now,
    });
    const holds = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const ready = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const active = ready.map((started, index) =>
      run(async () => {
        started.resolve();
        await holds[index]?.promise;
        return index;
      }),
    );
    try {
      await Promise.all(ready.map(({ promise }) => promise));
      const refused = await run(async () => 'unused').catch(
        (error: unknown) => error,
      );
      const noWriter = createBoundedTransaction({
        lane: testLane(client, 1),
        now: performance.now,
      });
      const refusedSmall = await noWriter(async () => 'unused').catch(
        (error: unknown) => error,
      );
      assert({
        given:
          'two active writers on four connections and a separate one-connection lane',
        should: 'reject a third and reserve recovery capacity on both lanes',
        actual: [isCapacityRefusal(refused), isCapacityRefusal(refusedSmall)],
        expected: [true, true],
      });
    } finally {
      holds.forEach(({ resolve }) => resolve());
      await Promise.all(active);
    }
    assert({
      given: 'the writers released all connections',
      should: 'let a later writer claim a slot',
      actual: await run(async () => 'later'),
      expected: 'later',
    });
  }));

test('a late callback cannot commit a real previously acknowledged mutation', () =>
  withBoundedRound(async (fixture, _run, roundId, client) => {
    let now = 0;
    const run = createBoundedTransaction({
      lane: testLane(client, 4),
      now: () => now,
      executionMs: 3000,
    });
    const [before] =
      await fixture.sql`select resolution from rounds where id = ${roundId}`;
    const refused = await run(async (tx) => {
      await tx.execute(
        sql`update rounds set resolution = 'Late test write' where id = ${roundId}`,
      );
      now = 3000;
    }).catch((error: unknown) => {
      if (!isAppError(error)) throw error;
      return [error.message, Reflect.get(error.cause as object, 'recovery')];
    });
    const [after] =
      await fixture.sql`select resolution from rounds where id = ${roundId}`;
    assert({
      given:
        'the execution slice ending immediately after the callback’s real write',
      should:
        'report rollback, leave the prior resolution intact and distinguish capacity from unrelated errors',
      actual: [
        refused,
        after?.resolution,
        isCapacityRefusal(
          createAppError('INFRASTRUCTURE', 'Database capacity unavailable'),
        ),
        isCapacityRefusal(new Error('other')),
      ],
      expected: [
        ['Bounded transaction budget exceeded', 'rolled-back'],
        before?.resolution,
        false,
        false,
      ],
    });
  }));

test('waiting bounded writers acquire the actual freed slot in arrival order', () =>
  withPool(async (client) => {
    const run = createBoundedTransaction({
      lane: testLane(client, 2, 1000),
      now: performance.now,
    });
    const hold = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    const events: string[] = [];
    const first = run(async () => {
      ready.resolve();
      await hold.promise;
    });
    await ready.promise;
    const second = run(async () => {
      events.push('second');
    });
    const third = run(async () => {
      events.push('third');
    });
    const whileHeld = [...events];
    hold.resolve();
    await Promise.all([first, second, third]);
    assert({
      given: 'one active writer and two arrivals on the same one-writer lane',
      should: 'keep both queued until release, then admit them in order',
      actual: [whileHeld, events],
      expected: [[], ['second', 'third']],
    });
  }));
