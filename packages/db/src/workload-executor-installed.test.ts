import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createWorkloadExecutor, workloadDatabase } from './workload-executor';
import { deferred } from './workload-executor.test-support';
setupRitewayBun();

test('installed Drizzle descriptors cannot start extra transport work while capacity is held', async () => {
  const held = deferred();
  let calls = 0;
  const query = () => {
    calls++;
    return held.promise.then(() => []);
  };
  const transport = Object.assign(query, { options: {}, unsafe: query });
  const db = workloadDatabase(
    drizzle({ client: transport as unknown as SQL }),
    createWorkloadExecutor({ social: 1 }),
    'social',
  );
  const admitted = db.execute(sql`select 1`);
  await assertRejects({
    given: 'a mutable descriptor injected through the owning surface',
    should: 'refuse raw-receiver getter injection before it runs',
    actual: () =>
      Object.defineProperty(db, 'select', {
        get() {
          throw new Error('Raw receiver getter executed');
        },
      }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'prototype reflection of the owning surface',
    should: 'expose no raw mutable prototype',
    actual: Object.getPrototypeOf(db),
    expected: null,
  });
  for (const mutate of [
    () => Reflect.set(db, 'select', () => 0),
    () => Reflect.deleteProperty(db, 'select'),
    () => Reflect.setPrototypeOf(db, {}),
    () => Reflect.preventExtensions(db),
  ])
    await assertRejects({
      given: 'a held query and a reflective surface mutation',
      should: 'refuse mutation before touching the raw target',
      actual: mutate,
      code: 'INFRASTRUCTURE',
    });
  for (const capability of ['$client', 'session'])
    await assertRejects({
      given: 'an installed Drizzle object with one actual query held',
      should: `refuse reflective ${capability} escape`,
      actual: () => Object.getOwnPropertyDescriptor(db, capability)!.value,
      code: 'INFRASTRUCTURE',
    });
  await assertRejects({
    given: 'one social reservation occupied',
    should: 'refuse a second installed-driver execution',
    actual: () => db.execute(sql`select 2`),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'all descriptor and normal bypass attempts',
    should: 'start exactly the admitted transport call',
    actual: calls,
    expected: 1,
  });
  held.resolve();
  await admitted;
});

test('installed Drizzle child closes at callback completion while its driver commit is held', async () => {
  const callbackDone = deferred(),
    commit = deferred();
  let calls = 0;
  const childQuery = () => {
    calls++;
    return Promise.resolve([]);
  };
  const childTransport = Object.assign(childQuery, {
    options: {},
    unsafe: childQuery,
  });
  const outerQuery = () => Promise.resolve([]);
  const outerTransport = Object.assign(outerQuery, {
    options: {},
    begin: async (work: (tx: typeof childTransport) => Promise<unknown>) => {
      const result = await work(childTransport);
      callbackDone.resolve();
      await commit.promise;
      return result;
    },
  });
  const db = workloadDatabase(
    drizzle({ client: outerTransport as unknown as SQL }),
    createWorkloadExecutor({ social: 1 }),
    'social',
  );
  let execute!: typeof db.execute;
  const transaction = db.transaction(async (tx) => {
    execute = tx.execute;
  });
  await callbackDone.promise;
  await assertRejects({
    given: 'installed transaction callback returned but COMMIT remains held',
    should: 'refuse a captured child method before transport invocation',
    actual: () => execute(sql`select 3`),
    code: 'INFRASTRUCTURE',
  });
  await assertRejects({
    given: 'actual driver commit pending',
    should: 'retain the outer reservation',
    actual: () => db.execute(sql`select 4`),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'late child and competing outer SQL',
    should: 'start no unaccounted transport work',
    actual: calls,
    expected: 0,
  });
  commit.resolve();
  await transaction;
});
