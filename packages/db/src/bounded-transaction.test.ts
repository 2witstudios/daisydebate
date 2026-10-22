import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from './bounded-transaction';
import type { TransactionLifecycle } from './transaction-lifecycle';
import { fakeSql } from './scripted-bun-wire';
import { bounded, causeOf } from './bounded-transaction.test-support';

setupRitewayBun();

test('invalid execution budgets are refused before any reservation', async () => {
  const { client, reservations } = fakeSql([]);
  const factory = (executionMs: number) => () =>
    createBoundedTransaction({
      client,
      maxConnections: 4,
      now: () => 0,
      executionMs,
    });
  for (const executionMs of [0, 3001, 1.5, Number.NaN])
    await assertRejects({
      given: `a factory execution budget of ${executionMs}ms`,
      should: 'refuse the configuration as an invariant',
      actual: factory(executionMs),
      code: 'INVARIANT',
    });
  const { run } = bounded();
  for (const executionMs of [0, 3001, 2.5])
    await assertRejects({
      given: `a per-call slice of ${executionMs}ms`,
      should: 'refuse the slice before reserving a connection',
      actual: () => run(async () => 'never', { executionMs }),
      code: 'INVARIANT',
    });
  assert({
    given: 'only refused budgets',
    should: 'reserve no connection',
    actual: reservations.reserved,
    expected: 0,
  });
});

test('a committed transaction returns its result, receipt and both connections', async () => {
  const { run, queries, reservations } = bounded({ script: [[{ one: 1 }]] });
  const result = await run(async (tx, signal, receipt) => {
    const rows = await tx.execute(sql`select 1 as one`);
    return { rows: [...rows], aborted: signal.aborted, receipt };
  });
  assert({
    given: 'a callback that reads one row and returns',
    should:
      'return the result with a frozen writer receipt, and release the writer and control reservations',
    actual: {
      result,
      frozen: Object.isFrozen(result.receipt),
      order: queries.map(({ query }) => query.trim().split(/\s+/)[0]),
      reservations,
    },
    expected: {
      result: {
        rows: [{ one: 1 }],
        aborted: false,
        receipt: {
          receivedAt: '2026-10-22T12:00:00.000000Z',
          writer: { pid: 4242, backendStart: '2026-10-22 12:00:00.000000+00' },
        },
      },
      frozen: true,
      order: ['select', 'begin', 'select', 'select', 'commit'],
      reservations: { reserved: 2, released: 2, closed: 0 },
    },
  });
});

test('pool capacity keeps half the connections for recovery control', async () => {
  const { run } = bounded({ maxConnections: 4 });
  const hold = Promise.withResolvers<void>();
  const first = run(() => hold.promise.then(() => 'first'));
  const second = run(() => hold.promise.then(() => 'second'));
  await assertRejects({
    given: 'two admitted writers on a four-connection pool',
    should: 'refuse a third writer as capacity unavailable',
    actual: () => run(async () => 'third'),
    code: 'INFRASTRUCTURE',
  });
  hold.resolve();
  const settled = await Promise.all([first, second]);
  const after = await run(async () => 'after');
  assert({
    given: 'the held writers committing',
    should: 'free their slots for a later writer',
    actual: [...settled, after],
    expected: ['first', 'second', 'after'],
  });
  for (const maxConnections of [1, 2.5])
    await assertRejects({
      given: `a pool of ${maxConnections} connections`,
      should: 'refuse every writer rather than starve recovery',
      actual: () => bounded({ maxConnections }).run(async () => 'never'),
      code: 'INFRASTRUCTURE',
    });
});

test('the execution budget is checked after the callback and before commit', async () => {
  let clock = 0;
  const { run, queries } = bounded({ now: () => clock });
  const failure = await causeOf(() =>
    run(async () => {
      clock = 3000;
      return 'late';
    }),
  );
  assert({
    given: 'a callback that returns after its slice expired',
    should: 'roll back with the budget error before the writer sends commit',
    actual: {
      message: failure?.message,
      recovery: (failure?.cause as { recovery: string }).recovery,
      // Only the control connection's recovery transaction commits.
      writerCommitted:
        queries.findIndex(({ query }) => query.trim() === 'commit') <
        queries.findIndex(({ query }) =>
          query.includes('pg_terminate_backend'),
        ),
    },
    expected: {
      message: 'Transcript transaction budget exceeded',
      recovery: 'rolled-back',
      writerCommitted: false,
    },
  });
});

test('the transaction facade refuses controls and use after its callback', async () => {
  const { run } = bounded();
  let escaped: Parameters<Parameters<typeof run>[0]>[0] | undefined;
  await assertRejects({
    given: 'a callback reaching for a transaction control',
    should: 'refuse it as an adapter-owned invariant',
    actual: () =>
      run(async (tx) => {
        escaped = tx;
        return (tx as unknown as { transaction: unknown }).transaction;
      }),
    code: 'INVARIANT',
  });
  await assertRejects({
    given: 'raw configuration through the facade',
    should: 'refuse the statement before it reaches the server',
    actual: () =>
      run((tx) => tx.execute(sql.raw("select set_config('x','0',true)"))),
    code: 'INVARIANT',
  });
  await run(async (tx) => {
    escaped = tx;
  });
  await assertRejects({
    given: 'a facade retained after its callback returned',
    should: 'refuse any later use',
    actual: async () => escaped!.select(),
    code: 'INVARIANT',
  });
});

test('lifecycle hooks open before begin and close with the actual outcome', async () => {
  const events: string[] = [];
  const lifecycle: TransactionLifecycle = {
    open: async (_tx, metadata) => {
      events.push(`open:${metadata.writer.pid}`);
    },
    close: async (_tx, _metadata, outcome) => {
      events.push(`close:${outcome}`);
    },
  };
  const { run } = bounded();
  await run(async () => events.push('work'), { lifecycle });
  await assertRejects({
    given: 'a failing callback with lifecycle hooks',
    should: 'rethrow its code',
    actual: () =>
      run(
        async () => {
          throw createAppError('CONFLICT', 'stale');
        },
        { lifecycle },
      ),
    code: 'CONFLICT',
  });
  assert({
    given: 'one committed and one failed transaction with lifecycle hooks',
    should:
      'open each with the writer receipt and close with committed or aborted',
    actual: events,
    expected: [
      'open:4242',
      'work',
      'close:committed',
      'open:4242',
      'close:aborted',
    ],
  });
});
