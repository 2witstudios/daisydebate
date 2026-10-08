import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { claimUsername } from './username-claim';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const userId = 'u7b3c9d1e5f2k4m6n8p1r3t5';
const nextActorId = () => 'a1b2c3d4e5f6k7m8n9p1r3t5';

describe('claimUsername', () => {
  test('claims a free username and seats the human actor in one transaction', async () => {
    const { database, queries } = createTestDatabase([[{ id: userId }], []]);
    const claim = await claimUsername(
      database,
      { userId, username: 'wren' },
      nextActorId,
      undefined,
    );
    assert({
      given: 'a user whose username is null',
      should: 'claim it and insert the human actor',
      actual: claim,
      expected: { kind: 'claimed' },
    });
    assert({
      given: 'the claim transaction',
      should: 'update the user then insert the actor',
      actual: [
        queries[0]?.query.includes('update'),
        queries[1]?.query.includes('insert into "actors"'),
      ],
      expected: [true, true],
    });
  });

  test('reports unchanged for the owner retrying their own name', async () => {
    const { database } = createTestDatabase([[], [['Wren']]]);
    const claim = await claimUsername(
      database,
      { userId, username: 'wren' },
      nextActorId,
      undefined,
    );
    assert({
      given: 'a user whose username matches case-insensitively',
      should: 'report unchanged and write nothing more',
      actual: claim,
      expected: { kind: 'unchanged' },
    });
  });

  test('reports already-set when another name is held', async () => {
    const { database } = createTestDatabase([[], [['wren']]]);
    const claim = await claimUsername(
      database,
      { userId, username: 'finn' },
      nextActorId,
      undefined,
    );
    assert({
      given: 'a user who already holds a different username',
      should: 'refuse to overwrite it',
      actual: claim,
      expected: { kind: 'already-set' },
    });
  });

  test('reports unknown-user when the id names nobody', async () => {
    const { database } = createTestDatabase([[], []]);
    const claim = await claimUsername(
      database,
      { userId, username: 'wren' },
      nextActorId,
      undefined,
    );
    assert({
      given: 'a user id that names nobody',
      should: 'report it rather than claim anything',
      actual: claim,
      expected: { kind: 'unknown-user' },
    });
  });

  test('reports taken when the case-insensitive unique index refuses', async () => {
    const taken = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      { code: '23505' },
    );
    const { database } = createTestDatabase([taken]);
    const claim = await claimUsername(
      database,
      { userId, username: 'wren' },
      nextActorId,
      undefined,
    );
    assert({
      given: 'a concurrent claim that won the unique index',
      should: 'report taken and change nothing',
      actual: claim,
      expected: { kind: 'taken' },
    });
  });
});
