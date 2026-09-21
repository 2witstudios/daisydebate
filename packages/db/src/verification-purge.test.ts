import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase, type SinkEvent } from './index.test-support';

setupRitewayBun();

const before = '2026-09-19T00:00:00.000Z';

describe('verification purge', () => {
  test('deletes one bounded batch of rows expired before the cutoff', async () => {
    const { database, queries } = createTestDatabase([[['a'], ['b']]]);
    const deleted = await database.purgeExpiredVerifications({
      before,
      limit: 500,
    });
    const text = queries[0]?.query ?? '';
    assert({
      given: 'a cutoff and a batch limit',
      should:
        'issue one delete over a limited, lock-skipping subselect on the expiry column and report the deleted count',
      actual: {
        deleted,
        statements: queries.length,
        isDelete: /^delete from "verification"/i.test(text),
        expiryPredicate: /"expires_at" </i.test(text),
        limited: /limit \$\d/i.test(text),
        skipLocked: /for update skip locked/i.test(text),
        params: queries[0]?.params.includes(500),
      },
      expected: {
        deleted: 2,
        statements: 1,
        isDelete: true,
        expiryPredicate: true,
        limited: true,
        skipLocked: true,
        params: true,
      },
    });
  });

  test('an empty table deletes nothing and a driver failure is reported and rethrown', async () => {
    const empty = createTestDatabase([[]]);
    const events: SinkEvent[] = [];
    const failing = createTestDatabase([new Error('boom')], events);
    const outcome = await failing.database
      .purgeExpiredVerifications({ before, limit: 5 })
      .then(() => 'resolved')
      .catch(() => 'rejected');
    assert({
      given: 'no expired rows, and then a failing driver',
      should: 'return 0, and reject after reporting db.query.failed',
      actual: {
        none: await empty.database.purgeExpiredVerifications({
          before,
          limit: 5,
        }),
        outcome,
        reported: events.map((event) => event.event),
      },
      expected: {
        none: 0,
        outcome: 'rejected',
        reported: ['db.query.failed'],
      },
    });
  });

  test('refuses an invalid limit or cutoff instead of deleting unbounded', async () => {
    const { database, queries } = createTestDatabase([[]]);
    const results = await Promise.all(
      [
        { before, limit: 0 },
        { before, limit: 1.5 },
        { before: 'not a date', limit: 5 },
      ].map((input) =>
        database
          .purgeExpiredVerifications(input)
          .then(() => 'ran')
          .catch(() => 'refused'),
      ),
    );
    assert({
      given: 'a zero limit, a fractional limit and an unparsable cutoff',
      should: 'refuse each without touching the database',
      actual: { results, queries: queries.length },
      expected: { results: ['refused', 'refused', 'refused'], queries: 0 },
    });
  });
});
