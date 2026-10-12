import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createWorkloadExecutor } from './workload-admission';

setupRitewayBun();

import { deferred } from './workload-executor.test-support';

test('saturated social work cannot borrow competitive or renewal reservations', async () => {
  const executor = createWorkloadExecutor({
    social: 1,
    competitive: 1,
    renewal: 1,
  });
  const held = deferred();
  const running = executor.run('social', () => held.promise);
  await assertRejects({
    given: 'unavailable social capacity',
    should: 'refuse without running work',
    actual: () => executor.run('social', async () => true),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'one actual social operation still running',
    should: 'allow independent reserved lanes',
    actual: await Promise.all([
      executor.run('competitive', async () => 1),
      executor.run('renewal', async () => 2),
    ]),
    expected: [1, 2],
  });
  held.resolve();
  await running;
  assert({
    given: 'settled database work',
    should: 'release its reservation',
    actual: await executor.run('social', async () => true),
    expected: true,
  });
});

test('a caller timeout leaves actual work counted until rollback or cancellation settles', async () => {
  const executor = createWorkloadExecutor({ social: 1 });
  const held = deferred();
  const running = executor.run('social', () => held.promise);
  const caller = Promise.race([running, Promise.resolve('timeout')]);
  await caller;
  await assertRejects({
    given: 'unavailable social capacity',
    should: 'refuse without running work',
    actual: () => executor.run('social', async () => true),
    code: 'INFRASTRUCTURE',
  });
  held.resolve();
  await running;
});

test('failed work releases the lane and an unallocated workload is refused', async () => {
  const executor = createWorkloadExecutor({ control: 1 });
  await assertRejects({
    given: 'unavailable projection capacity',
    should: 'refuse without running work',
    actual: () => executor.run('projection', async () => true),
    code: 'INFRASTRUCTURE',
  });
  const failure = await executor
    .run('control', async () => {
      throw new Error('rollback settled');
    })
    .catch((error: Error) => error.message);
  assert({
    given: 'failed actual work',
    should: 'preserve the failure through settlement',
    actual: failure,
    expected: 'rollback settled',
  });
  assert({
    given: 'rollback has settled',
    should: 'allow the next control operation',
    actual: await executor.run('control', async () => true),
    expected: true,
  });
});

test('lazy statements and complete transactions share one executor without nested admission', async () => {
  const { workloadDatabase } = await import('./workload-executor');
  const executor = createWorkloadExecutor({ competitive: 1 });
  const held = deferred();
  let statements = 0;
  const raw = {
    select: () => ({
      from: () => ({
        then: (resolve: (value: number) => unknown) => {
          statements++;
          return held.promise.then(() => resolve(7));
        },
      }),
    }),
    transaction: async (
      work: (tx: { execute: () => Promise<number> }) => Promise<number>,
    ) => work({ execute: async () => 9 }),
  };
  const database = workloadDatabase(raw, executor, 'competitive');
  const reading = Promise.resolve(database.select().from());
  // Await assimilation of the lazy query before probing admission.
  await Promise.resolve();
  await assertRejects({
    given: 'a lazy SQL statement in the sole competitive slot',
    should: 'refuse another transaction before SQL starts',
    actual: () => database.transaction(async (tx) => tx.execute()),
    code: 'INFRASTRUCTURE',
  });
  held.resolve();
  assert({
    given: 'settled reader followed by transaction child SQL',
    should: 'count exactly one reservation per actual database owner',
    actual: [
      await reading,
      await database.transaction(async (tx) => tx.execute()),
      statements,
    ],
    expected: [7, 9, 1],
  });
});
