import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createWorkloadExecutor } from './workload-executor';
import { deferred } from './workload-executor.test-support';
setupRitewayBun();

test('captured transaction method closures refuse execution after settlement', async () => {
  const { workloadDatabase } = await import('./workload-executor');
  let called = 0;
  const raw = {
    transaction: async (
      work: (tx: {
        execute: () => Promise<number>;
        select: () => unknown;
      }) => Promise<void>,
    ) => work({ execute: async () => ++called, select: () => ++called }),
  };
  const db = workloadDatabase(
    raw,
    createWorkloadExecutor({ control: 1 }),
    'control',
  );
  let execute!: () => Promise<number>, select!: () => unknown;
  await db.transaction(async (tx) => {
    execute = tx.execute;
    select = tx.select;
  });
  for (const method of [execute, select])
    await assertRejects({
      given: 'a captured child method closure after commit',
      should: 'refuse at invocation before calling the driver',
      actual: method,
      code: 'INFRASTRUCTURE',
    });
  assert({
    given: 'expired captured closures',
    should: 'perform no database work',
    actual: called,
    expected: 0,
  });
});

test('an eager native Promise is admitted before invocation and remains counted until settlement', async () => {
  const { workloadDatabase } = await import('./workload-executor');
  const held = deferred();
  let calls = 0;
  const db = workloadDatabase(
    {
      select: () => {
        calls++;
        return held.promise;
      },
    },
    createWorkloadExecutor({ social: 1 }),
    'social',
  );
  const first = db.select();
  await assertRejects({
    given: 'a native Promise still running',
    should: 'refuse before invoking a second eager operation',
    actual: () => db.select(),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'saturated eager work',
    should: 'invoke the raw entry point once',
    actual: calls,
    expected: 1,
  });
  held.resolve();
  await first;
  await db.select();
  assert({
    given: 'actual native work settled',
    should: 'release capacity for the next invocation',
    actual: calls,
    expected: 2,
  });
});

test('reflection cannot expose driver/session/prepared closures or extend transaction method lifetime', async () => {
  const { workloadDatabase } = await import('./workload-executor');
  const raw = {
    $client: { unsafe: async () => 1 },
    session: { client: { unsafe: async () => 2 } },
    select: () => ({
      prepare: () => ({ executor: async () => 3, execute: async () => 4 }),
    }),
    transaction: async (
      work: (tx: { execute: () => Promise<number> }) => Promise<void>,
    ) => work({ execute: async () => 5 }),
  };
  const db = workloadDatabase(
    raw,
    createWorkloadExecutor({ control: 1 }),
    'control',
  );
  for (const [object, key] of [
    [db, '$client'],
    [db, 'session'],
    [db.select().prepare(), 'executor'],
  ] as const)
    await assertRejects({
      given: 'a reflective descriptor of a raw database capability',
      should: 'refuse before returning its raw value',
      actual: () => Object.getOwnPropertyDescriptor(object, key)?.value,
      code: 'INFRASTRUCTURE',
    });
  let captured!: () => Promise<number>;
  await db.transaction(async (tx) => {
    captured = Object.getOwnPropertyDescriptor(tx, 'execute')!.value;
  });
  await assertRejects({
    given: 'a reflected child method captured before commit',
    should: 'check lifetime again when invoked',
    actual: captured,
    code: 'INFRASTRUCTURE',
  });
});

test('callback completion closes child admission while COMMIT retains the owning reservation', async () => {
  const { workloadDatabase } = await import('./workload-executor');
  const commit = deferred(),
    callbackDone = deferred();
  let calls = 0;
  const executor = createWorkloadExecutor({ control: 1 });
  const raw = {
    transaction: async (
      work: (tx: { execute: () => Promise<number> }) => Promise<void>,
    ) => {
      await work({ execute: async () => ++calls });
      callbackDone.resolve();
      await commit.promise;
    },
  };
  const db = workloadDatabase(raw, executor, 'control');
  let captured!: () => Promise<number>;
  const transaction = db.transaction(async (tx) => {
    captured = tx.execute;
  });
  await callbackDone.promise;
  await assertRejects({
    given: 'callback finished while the driver is still committing',
    should: 'refuse captured child invocation',
    actual: captured,
    code: 'INFRASTRUCTURE',
  });
  await assertRejects({
    given: 'COMMIT still pending',
    should: 'retain outer actual-work occupancy',
    actual: () => executor.run('control', async () => true),
    code: 'INFRASTRUCTURE',
  });
  commit.resolve();
  await transaction;
  assert({
    given: 'settled commit',
    should: 'release the outer slot without executing escaped work',
    actual: [await executor.run('control', async () => true), calls],
    expected: [true, 0],
  });
});

test('already admitted child work settles before the driver starts COMMIT', async () => {
  const { workloadDatabase } = await import('./workload-executor');
  const child = deferred(),
    returned = deferred();
  let committing = 0;
  const raw = {
    transaction: async (
      work: (tx: { execute: () => Promise<void> }) => Promise<void>,
    ) => {
      await work({ execute: () => child.promise });
      committing++;
    },
  };
  const db = workloadDatabase(
    raw,
    createWorkloadExecutor({ control: 1 }),
    'control',
  );
  let captured!: () => Promise<void>;
  const transaction = db.transaction(async (tx) => {
    captured = tx.execute;
    void tx.execute();
    returned.resolve();
  });
  await returned.promise;
  await assertRejects({
    given: 'callback returned with admitted child SQL still running',
    should: 'close new child admission before settlement',
    actual: captured,
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'admitted child still running',
    should: 'defer COMMIT',
    actual: committing,
    expected: 0,
  });
  child.resolve();
  await transaction;
  assert({
    given: 'all admitted SQL settled',
    should: 'allow exactly one commit',
    actual: committing,
    expected: 1,
  });
});
