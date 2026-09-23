import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
import { createTestOnlyOperations } from '../src/test-only-operations';
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');
test('durable records survive reconnect; optimistic writes reject stale updates', async () => {
  const id = createId();
  const userId = createId();
  const actorId = createId();
  const formatId = `fmt-${createId()}`;
  const database = createDatabase({ url, nextActorId: createId });
  const fixture = new SQL(url);
  const testOnly = createTestOnlyOperations({ client: fixture });
  try {
    expect(await database.health()).toBe(true);
    await testOnly.createUser({ id: userId, username: `test-${userId}` });
    // Competitive rows reference actors, and formats are a reference table;
    // neither has an adapter writer yet (ADR 0029), so the fixture inserts them.
    await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
    await fixture`insert into formats (id, name, rules, ranked_eligible) values (${formatId}, 'Fixture', '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":0},"clock":{"speechMs":1000,"prepMs":0}}'::jsonb, false)`;
    await database.createDebate({
      id,
      createdBy: actorId,
      resolution: 'Architecture proof',
      format: formatId,
      snapshot: { version: 1, id, phase: 'waiting' },
      mode: 'casual',
      visibility: 'unlisted',
    });
    await database.close();
    const reopened = createDatabase({ url, nextActorId: createId });
    try {
      const stored = await reopened.getDebate(id);
      expect(stored?.snapshot).toEqual({ version: 1, id, phase: 'waiting' });
      expect([stored?.mode, stored?.phase, stored?.visibility]).toEqual([
        'casual',
        'waiting',
        'unlisted',
      ]);
      const outcomes = await Promise.all(
        [1, 2].map((value) =>
          testOnly.saveSnapshot({
            id,
            expectedVersion: 1,
            snapshot: { value, phase: 'active' },
            updatedAt: '2026-01-01T00:00:00.000Z',
          }),
        ),
      );
      const won = outcomes.filter(Boolean);
      expect(won).toHaveLength(1);
      // The phase projection travels with the snapshot in the same UPDATE.
      expect([won[0]?.phase, won[0]?.startedAt]).toEqual([
        'active',
        '2026-01-01T00:00:00.000Z',
      ]);
    } finally {
      await reopened.close();
    }
  } finally {
    await database.close();
    try {
      await fixture`DELETE FROM debates WHERE id=${id}`;
      await fixture`DELETE FROM actors WHERE id=${actorId}`;
      await fixture`DELETE FROM users WHERE id=${userId}`;
      await fixture`DELETE FROM formats WHERE id=${formatId}`;
    } finally {
      await fixture.close();
    }
  }
});
