import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { createTestOnlyOperations } from '../src/test-only-operations';
import { snapshotFor } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('durable records survive reconnect; optimistic writes reject stale updates', async () => {
  const id = createId();
  const userId = createId();
  const actorId = createId();
  const formatId = `fmt-${createId()}`;
  const database = createDatabase({ url, nextActorId: createId });
  const fixture = new SQL(url);
  const testOnly = createTestOnlyOperations({ client: fixture });
  try {
    const healthy = await database.health();
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
      snapshot: snapshotFor(id, { format: formatId }),
      mode: 'casual',
      visibility: 'unlisted',
    });
    await database.close();
    const reopened = createDatabase({ url, nextActorId: createId });
    try {
      const stored = await reopened.getDebate(id);
      const outcomes = await Promise.all(
        [1, 2].map((value) =>
          testOnly.saveSnapshot({
            id,
            expectedVersion: 1,
            snapshot: snapshotFor(id, {
              format: formatId,
              phase: 'active',
              resolution: `attempt ${value}`,
            }),
            updatedAt: '2026-01-01T00:00:00.000Z',
          }),
        ),
      );
      const won = outcomes.filter(Boolean);
      assert({
        given:
          'a debate written, the connection reopened, and two concurrent writes against version 1',
        should:
          'read back the stored snapshot and projections, and let exactly one write win, moving the phase projection with it',
        actual: {
          healthy,
          snapshot: stored?.snapshot,
          projections: [stored?.mode, stored?.phase, stored?.visibility],
          winners: won.length,
          winner: [won[0]?.phase, won[0]?.startedAt],
        },
        expected: {
          healthy: true,
          snapshot: snapshotFor(id, { format: formatId }),
          projections: ['casual', 'waiting', 'unlisted'],
          winners: 1,
          winner: ['active', '2026-01-01T00:00:00.000Z'],
        },
      });
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
