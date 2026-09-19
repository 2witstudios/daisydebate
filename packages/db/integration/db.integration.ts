import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createDatabase } from '../src';
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');
test('durable records survive reconnect; optimistic writes reject stale updates', async () => {
  const id = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const database = createDatabase({ url });
  try {
    expect(await database.health()).toBe(true);
    await database.createUser({ id: userId, username: `test-${userId}` });
    await database.createDebate({
      id,
      createdBy: userId,
      resolution: 'Architecture proof',
      format: 'foundation',
      snapshot: { version: 1, id },
    });
    await database.close();
    const reopened = createDatabase({ url });
    try {
      expect((await reopened.getDebate(id))?.snapshot).toEqual({
        version: 1,
        id,
      });
      const outcomes = await Promise.all(
        [1, 2].map((value) =>
          reopened.saveSnapshot({
            id,
            expectedVersion: 1,
            snapshot: { value },
            updatedAt: '2026-01-01T00:00:00.000Z',
          }),
        ),
      );
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    } finally {
      await reopened.close();
    }
  } finally {
    await database.close();
    const cleanup = new SQL(url);
    try {
      await cleanup`DELETE FROM debates WHERE id=${id}`;
      await cleanup`DELETE FROM users WHERE id=${userId}`;
    } finally {
      await cleanup.close();
    }
  }
});
