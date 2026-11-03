import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { instrumented } from './instrumented';
import { refuseCapacity } from './capacity-refusal';

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
