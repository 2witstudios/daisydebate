import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { createTestOnlyOperations } from '../src/test-only-operations';
import { snapshotFor } from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const snapshotOf = (
  id: string,
  phase: 'waiting' | 'active',
  participants: ReadonlyArray<{
    id: string;
    side: 'affirmative' | 'negative';
    ready: boolean;
  }>,
) => snapshotFor(id, { phase, participants });

/**
 * ISSUE-6: `debate_participants` is a projection of the snapshot's
 * `participants` (ADR 0029: snapshot participant ids are actor ids), so it
 * is written in the same transaction as every snapshot write and always
 * equals the snapshot's seats.
 */
test('debate_participants is written in the snapshot transaction and always equals the snapshot seats', async () => {
  const fixture = new SQL(url, { max: 1 });
  const database = createDatabase({ url, nextActorId: createId });
  const testOnly = createTestOnlyOperations({ client: fixture });
  const debateId = createId();
  const users = [createId(), createId()];
  const [first, second] = [createId(), createId()];
  const seats = () => fixture`
    select actor_id, role, slot, status
    from debate_participants where debate_id = ${debateId}
    order by role
  `;
  try {
    for (const [index, actorId] of [first, second].entries()) {
      await fixture`insert into users (id) values (${users[index]})`;
      await fixture`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${users[index]})`;
    }
    await database.createDebate({
      id: debateId,
      createdBy: null,
      resolution: 'integration proof',
      format: 'foundation',
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: first!, side: 'affirmative', ready: false },
      ]),
      mode: 'casual',
      visibility: 'unlisted',
    });
    const afterCreate = await seats();
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 1,
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: first!, side: 'affirmative', ready: true },
        { id: second!, side: 'negative', ready: false },
      ]),
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    const afterJoin = await seats();
    await testOnly.saveSnapshot({
      id: debateId,
      expectedVersion: 2,
      snapshot: snapshotOf(debateId, 'waiting', [
        { id: second!, side: 'negative', ready: true },
      ]),
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    const afterLeave = await seats();
    assert({
      given: 'a debate created, joined and left through snapshot writes',
      should: 'hold exactly the snapshot participants after every write',
      actual: { afterCreate, afterJoin, afterLeave },
      expected: {
        afterCreate: [
          { actor_id: first, role: 'affirmative', slot: 0, status: 'joined' },
        ],
        afterJoin: [
          { actor_id: first, role: 'affirmative', slot: 0, status: 'ready' },
          { actor_id: second, role: 'negative', slot: 0, status: 'joined' },
        ],
        afterLeave: [
          { actor_id: second, role: 'negative', slot: 0, status: 'ready' },
        ],
      },
    });

    const version = await (async () => {
      try {
        await testOnly.saveSnapshot({
          id: debateId,
          expectedVersion: 3,
          snapshot: snapshotOf(debateId, 'waiting', [
            { id: createId(), side: 'affirmative', ready: false },
          ]),
          updatedAt: '2026-01-01T00:03:00.000Z',
        });
        return 'saved';
      } catch {
        const [row] =
          await fixture`select version from debates where id = ${debateId}`;
        return row?.version;
      }
    })();
    assert({
      given: 'a snapshot naming a participant that is not an actor',
      should:
        'refuse the whole write, leaving the snapshot version and seats unchanged',
      actual: { version, seats: await seats() },
      expected: { version: 3, seats: afterLeave },
    });
  } finally {
    await database.close();
    await fixture`delete from debates where id = ${debateId}`;
    await fixture`delete from actors where id in ${fixture([first!, second!])}`;
    await fixture`delete from users where id in ${fixture(users)}`;
    await fixture.close();
  }
});
