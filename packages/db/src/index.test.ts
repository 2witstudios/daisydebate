import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTableName } from 'drizzle-orm';
import { debates } from './schema/debates';
import { users } from './schema/users';
import { createDatabase } from './index';
import { expect } from 'bun:test';

setupRitewayBun();

describe('persistence schema', () => {
  test('tables have independent ownership', () => {
    assert({
      given: 'the durable debate and user tables',
      should: 'map to independent PostgreSQL tables',
      actual: [getTableName(debates), getTableName(users)],
      expected: ['debates', 'users'],
    });
  });
});

describe('database adapter failures', () => {
  test('reports a failed query through the injected event sink', async () => {
    const events: Array<{
      event: string;
      fields: Record<string, unknown>;
      message: string;
    }> = [];
    const database = createDatabase({
      url: 'postgresql://user:password@127.0.0.1:1/daisy',
      eventSink: (event, fields, message) =>
        events.push({ event, fields, message }),
    });

    await expect(database.health()).rejects.toThrow();

    assert({
      given: 'a database query that fails',
      should: 'emit the database query failure event with the operation name',
      actual: events,
      expected: [
        {
          event: 'db.query.failed',
          fields: { operation: 'health' },
          message: 'Database query failed',
        },
      ],
    });
  });
});
