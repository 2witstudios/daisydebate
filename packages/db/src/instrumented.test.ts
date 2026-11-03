import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { instrumented } from './instrumented';
import { refuseCapacity, reportCapacityHolders } from './capacity-refusal';
import { currentLaneOperation, namedLaneOperations } from './lane-operation';

setupRitewayBun();

test('unrun work is a capacity refusal while genuine query failures remain failures', async () => {
  for (const [error, event] of [
    [refuseCapacity(), 'db.capacity.refused'],
    [
      new Error('driver wrapper', { cause: refuseCapacity() }),
      'db.capacity.refused',
    ],
    [createAppError('INFRASTRUCTURE'), 'db.query.failed'],
    [new Error('query failed'), 'db.query.failed'],
    [
      createAppError(
        'INFRASTRUCTURE',
        'Transcript transaction budget exceeded',
      ),
      'db.query.failed',
    ],
  ] as const) {
    const events: unknown[] = [];
    const caught: unknown = await instrumented(
      (event, fields) => events.push({ event, fields }),
      'lookup',
      async () => {
        throw error;
      },
    ).catch((error: unknown) => error);
    assert({
      given: `${event === 'db.capacity.refused' ? 'unrun refused work' : 'an executing query failure'} in a database operation`,
      should:
        "report the classified event, naming a refusal's lane, and preserve the rejection identity",
      actual: { events, unchanged: caught === error },
      expected: {
        events: [
          {
            event,
            fields:
              event === 'db.capacity.refused'
                ? { operation: 'lookup', cause: 'unknown.saturated' }
                : { operation: 'lookup' },
          },
        ],
        unchanged: true,
      },
    });
  }
});

test('a refusal says which lane refused it and how that lane stood (ISSUE-1130)', async () => {
  const events: unknown[] = [];
  await instrumented(
    (event, fields) => events.push({ event, fields }),
    'lookup',
    async () => {
      throw refuseCapacity({
        lane: 'competitive',
        reason: 'expired',
        pressure: { pending: 16, running: 10, oldestAgeMs: 1200 },
      });
    },
  ).catch(() => undefined);
  assert({
    given: 'a lane that refused work while under pressure',
    should: 'log the lane, the reason and the pressure with the operation',
    actual: events,
    expected: [
      {
        event: 'db.capacity.refused',
        fields: {
          operation: 'lookup',
          cause: 'competitive.expired',
          pending: 16,
          running: 10,
          oldestAgeMs: 1200,
        },
      },
    ],
  });
});

test('a refusal reports each operation holding the lane (ISSUE-1110)', async () => {
  const events: unknown[] = [];
  await instrumented(
    (event, fields) => events.push({ event, fields }),
    'lookup',
    async () => {
      throw refuseCapacity({
        lane: 'competitive',
        reason: 'saturated',
        holders: { executeRoundTick: 7, readLaunchedRound: 3 },
      });
    },
  ).catch(() => undefined);
  assert({
    given: 'a lane refusal that knows its holders',
    should: 'log the refusal, then one line per holding operation',
    actual: events,
    expected: [
      {
        event: 'db.capacity.refused',
        fields: { operation: 'lookup', cause: 'competitive.saturated' },
      },
      {
        event: 'db.capacity.holder',
        fields: {
          operation: 'executeRoundTick',
          cause: 'competitive',
          running: 7,
        },
      },
      {
        event: 'db.capacity.holder',
        fields: {
          operation: 'readLaunchedRound',
          cause: 'competitive',
          running: 3,
        },
      },
    ],
  });
});

test('a lazy query counts under its operation, not only an async one', async () => {
  // A query builder: it starts when awaited, after the callback has returned.
  const lazy = {
    then: (resolve: (operation: string) => void) =>
      resolve(currentLaneOperation()),
  } as unknown as Promise<string>;
  const seen = await instrumented(undefined, 'lookup', () => lazy);
  assert({
    given: 'an operation returning a thenable that runs when awaited',
    should: 'still read that operation as the current one',
    actual: seen,
    expected: 'lookup',
  });
});

test('the operation runs under its own name, for the lane to read', async () => {
  const seen = await instrumented(undefined, 'lookup', async () =>
    currentLaneOperation(),
  );
  assert({
    given: 'work inside an operation',
    should: 'read that operation as the current one',
    actual: seen,
    expected: 'lookup',
  });
});

test('a domain refusal inside an operation is an answer, not a database failure (ISSUE-555)', async () => {
  for (const code of ['CONFLICT', 'NOT_FOUND', 'AUTHORIZATION'] as const) {
    const events: unknown[] = [];
    const error = createAppError(code);
    const caught: unknown = await instrumented(
      (event) => events.push(event),
      'lookup',
      async () => {
        throw error;
      },
    ).catch((rejection: unknown) => rejection);
    assert({
      given: `a ${code} refusal thrown inside a database operation`,
      should: 'report no database event and preserve the rejection',
      actual: { events, unchanged: caught === error },
      expected: { events: [], unchanged: true },
    });
  }
});

test('an invariant breach inside an operation stays a database failure', async () => {
  const events: unknown[] = [];
  await instrumented(
    (event) => events.push(event),
    'lookup',
    async () => {
      throw createAppError('INVARIANT');
    },
  ).catch(() => undefined);
  assert({
    given: 'an INVARIANT error thrown inside a database operation',
    should: 'still report db.query.failed',
    actual: events,
    expected: ['db.query.failed'],
  });
});

test('named operations run under their own names and keep everything else', async () => {
  const named = namedLaneOperations({
    readFoo: async () => currentLaneOperation(),
    constant: 7,
  });
  assert({
    given: 'a set of reads no instrumented wraps',
    should: 'run each under its name and leave other values alone',
    actual: [await named.readFoo(), named.constant],
    expected: ['readFoo', 7],
  });
});

test('a refusal is reported once, by whichever boundary reaches it first', () => {
  const refusal = refuseCapacity({
    lane: 'competitive',
    reason: 'saturated',
    holders: { readFoo: 1 },
  });
  const lines: unknown[] = [];
  const log = (_event: string, fields: unknown) => lines.push(fields);
  reportCapacityHolders(refusal, log);
  reportCapacityHolders(new Error('wrapper', { cause: refusal }), log);
  reportCapacityHolders(new Error('no refusal'), log);
  assert({
    given: 'one refusal reaching two boundaries, and other errors',
    should: 'log its holders once and nothing for the rest',
    actual: lines,
    expected: [{ operation: 'readFoo', cause: 'competitive', running: 1 }],
  });
});

test('nested stores and what a factory returns hold under their own names', async () => {
  const read = async () => currentLaneOperation();
  const named = namedLaneOperations({
    maintenance: { run: read },
    friendStore: () => ({ withContacts: read }),
  });
  assert({
    given: 'an object of operations and a factory of them',
    should: 'name each member by its path',
    actual: [
      await named.maintenance.run(),
      await named.friendStore().withContacts(),
    ],
    expected: ['maintenance.run', 'friendStore.withContacts'],
  });
});

test('a lazy query through a named operation keeps its name', async () => {
  const lazy = {
    then: (resolve: (operation: string) => void) =>
      resolve(currentLaneOperation()),
  };
  const named = namedLaneOperations({ readFoo: () => lazy });
  assert({
    given: 'an operation returning a thenable that runs when awaited',
    should: 'read that operation as the current one',
    actual: await named.readFoo(),
    expected: 'readFoo',
  });
});

test('naming changes no plain value or sync return', () => {
  const view = { kind: 'view', rows: [1] };
  const when = new Date(0);
  const fn = Object.assign(() => view, { label: 'kept' });
  const named = namedLaneOperations({
    view: fn,
    when: () => when,
    constant: 7,
  });
  assert({
    given: 'data returned synchronously, a class instance and a constant',
    should: 'return the same values, keep function properties',
    actual: [
      named.view() === view,
      named.when() === when,
      named.constant,
      named.view.label,
    ],
    expected: [true, true, 7, 'kept'],
  });
});
