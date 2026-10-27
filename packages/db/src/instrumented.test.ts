import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { instrumented } from './instrumented';
import { refuseCapacity } from './transaction-admission';

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
        'report the classified event with only the operation, and preserve the rejection identity',
      actual: { events, unchanged: caught === error },
      expected: {
        events: [{ event, fields: { operation: 'lookup' } }],
        unchanged: true,
      },
    });
  }
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
