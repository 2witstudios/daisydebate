import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createWorkloadExecutor } from './workload-admission';
import { workloadDatabase } from './workload-executor';
import { deferred } from './workload-executor.test-support';

setupRitewayBun();

/** Manual timers: waits expire only when the test fires them. */
const manualTimers = () => {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    timers: {
      setTimeout: (callback: () => void) => {
        pending.set(++next, callback);
        return next;
      },
      clearTimeout: (id: number) => void pending.delete(id),
    },
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    size: () => pending.size,
  };
};

test('saturated work waits in a bounded FIFO queue and receives settled slots in order', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { control: 1 },
    {
      queues: { control: { depth: 2, maxWaitMs: 1_000 } },
      timers: clock.timers,
    },
  );
  const held = deferred();
  const order: string[] = [];
  const running = executor.run('control', async () => {
    await held.promise;
    order.push('first');
  });
  const second = executor.run('control', async () => order.push('second'));
  const third = executor.run('control', async () => order.push('third'));
  await assertRejects({
    given: 'a full lane and a full wait queue',
    should: 'refuse the next operation without running it',
    actual: () => executor.run('control', async () => order.push('refused')),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'queued operations behind running work',
    should: 'not start before a slot settles',
    actual: order,
    expected: [],
  });
  held.resolve();
  await Promise.all([running, second, third]);
  assert({
    given: 'the running operation settled',
    should: 'hand slots to waiters in arrival order and clear their timers',
    actual: { order, timers: clock.size() },
    expected: { order: ['first', 'second', 'third'], timers: 0 },
  });
});

test('a waiter that reaches its age bound is refused and never runs', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { social: 1 },
    {
      queues: { social: { depth: 1, maxWaitMs: 100 } },
      timers: clock.timers,
    },
  );
  const held = deferred();
  let ran = false;
  const running = executor.run('social', () => held.promise);
  const waiting = executor.run('social', async () => {
    ran = true;
  });
  clock.fire();
  await assertRejects({
    given: 'a queued operation whose wait expired',
    should: 'refuse as unavailable capacity',
    actual: () => waiting,
    code: 'INFRASTRUCTURE',
  });
  held.resolve();
  await running;
  assert({
    given: 'the slot released after the waiter expired',
    should: 'never run the expired work and admit the next operation',
    actual: { ran, next: await executor.run('social', async () => 'next') },
    expected: { ran: false, next: 'next' },
  });
});

test('a lazy statement on a saturated lane builds now but executes only once it holds a slot', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { competitive: 1 },
    {
      queues: { competitive: { depth: 1, maxWaitMs: 50 } },
      timers: clock.timers,
    },
  );
  const held = deferred();
  let executed = 0;
  const raw = {
    select: () => ({
      from: (table: string) => ({
        then: (resolve: (value: string) => unknown) => {
          executed++;
          return resolve(table);
        },
      }),
    }),
  };
  const database = workloadDatabase(raw, executor, 'competitive');
  const running = executor.run('competitive', () => held.promise);
  const reading = Promise.resolve(database.select().from('rows'));
  await Promise.resolve();
  assert({
    given: 'a saturated lane with queue room',
    should: 'not execute the statement before a slot is granted',
    actual: executed,
    expected: 0,
  });
  held.resolve();
  await running;
  assert({
    given: 'the slot granted to the queued statement',
    should: 'execute it once and resolve its result',
    actual: { result: await reading, executed },
    expected: { result: 'rows', executed: 1 },
  });
});

test('a saturated lane schedules refusal at its own configured age', async () => {
  const scheduled: number[] = [];
  const executor = createWorkloadExecutor(
    { competitive: 1, social: 1 },
    {
      queues: {
        competitive: { depth: 1, maxWaitMs: 50 },
        social: { depth: 1, maxWaitMs: 100 },
      },
      timers: {
        setTimeout: (callback: () => void, ms: number) => {
          scheduled.push(ms);
          queueMicrotask(callback);
          return 0;
        },
        clearTimeout: () => undefined,
      },
    },
  );
  const held = deferred();
  const running = [
    executor.run('competitive', () => held.promise),
    executor.run('social', () => held.promise),
  ];
  const refused = await Promise.all(
    (['competitive', 'social'] as const).map((lane) =>
      executor.run(lane, async () => 'ran').catch((error) => error.code),
    ),
  );
  held.resolve();
  await Promise.all(running);
  assert({
    given: 'one waiter per saturated lane whose age elapses',
    should: 'refuse each at its own lane age without running it',
    actual: { scheduled, refused },
    expected: {
      scheduled: [50, 100],
      refused: ['INFRASTRUCTURE', 'INFRASTRUCTURE'],
    },
  });
});

test('a statement composed from subqueries on a saturated lane renders now and executes once it holds a slot', async () => {
  const { drizzle } = await import('drizzle-orm/bun-sql');
  const { eq, notExists } = await import('drizzle-orm');
  const { pgTable, text } = await import('drizzle-orm/pg-core');
  const parents = pgTable('parents', { id: text('id').primaryKey() });
  const children = pgTable('children', { parentId: text('parent_id') });
  const statements: string[] = [];
  const query = (statement: string) => {
    statements.push(statement);
    return Promise.resolve([]);
  };
  const transport = Object.assign(query, { options: {}, unsafe: query });
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { social: 1 },
    {
      queues: { social: { depth: 4, maxWaitMs: 100 } },
      timers: clock.timers,
    },
  );
  const db = workloadDatabase(
    drizzle({ client: transport as unknown as import('bun').SQL }),
    executor,
    'social',
  );
  const held = deferred();
  const running = executor.run('social', () => held.promise);
  const removal = Promise.resolve(
    db
      .delete(parents)
      .where(
        notExists(
          db
            .select({ parentId: children.parentId })
            .from(children)
            .where(eq(children.parentId, parents.id)),
        ),
      ),
  );
  await Promise.resolve();
  const before = statements.length;
  held.resolve();
  await running;
  await removal;
  assert({
    given: 'a delete whose predicate embeds a subquery built while saturated',
    should:
      'wait for the slot without SQL, then execute one statement with the rendered subquery',
    actual: {
      before,
      executed: statements.length,
      subquery: statements[0]?.includes('not exists') ?? false,
    },
    expected: { before: 0, executed: 1, subquery: true },
  });
});

test('eager work started on a saturated lane stays counted until it settles', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { social: 1 },
    {
      queues: { social: { depth: 2, maxWaitMs: 100 } },
      timers: clock.timers,
    },
  );
  const held = deferred(),
    eager = deferred();
  const database = workloadDatabase(
    { select: () => eager.promise },
    executor,
    'social',
  );
  const running = executor.run('social', () => held.promise);
  const started = database.select();
  let ran = false;
  const queued = executor.run('social', async () => {
    ran = true;
  });
  held.resolve();
  await running;
  await Promise.resolve();
  const whileEager = ran;
  eager.resolve();
  await started;
  await queued;
  assert({
    given: 'held work, then eager construction work beyond capacity',
    should:
      'keep the queued operation waiting until the eager work settles too',
    actual: { whileEager, after: ran },
    expected: { whileEager: false, after: true },
  });
});
